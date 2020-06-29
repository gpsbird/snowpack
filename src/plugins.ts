import {SnowpackConfig, SnowpackPlugin} from './config';

type RunCmd = {id: string; cmd: string};

function handleError(msg: string) {
  console.error(`[error]: ${msg}`);
  process.exit(1);
}

/** ensure extensions all have preceding dots */
function parseScript(script: string): {scriptType: string; extensions: string[]} {
  const [scriptType, extMatch] = script.toLowerCase().split(':');
  return {
    scriptType,
    extensions: [...new Set(extMatch.split(',').map((ext) => `.${ext}`.replace(/^\./, '').trim()))], // only keep unique extensions
  };
}

/** load and normalize plugins from config */
export function loadPlugins(
  config: SnowpackConfig,
): {
  plugins: SnowpackPlugin[];
  bundler: SnowpackPlugin | undefined;
  runCommands: RunCmd[];
  buildCommands: Record<string, RunCmd>;
} {
  const plugins: SnowpackPlugin[] = [];
  const runCommands: RunCmd[] = [];
  let bundler: SnowpackPlugin | undefined;

  function loadPluginFromScript(specifier: string): SnowpackPlugin | undefined {
    try {
      const pluginLoc = require.resolve(specifier, {paths: [process.cwd()]});
      return require(pluginLoc)(config); // no plugin options to load because we’re loading from a string
    } catch (err) {
      // ignore
    }
  }

  function loadPluginFromConfig(name: string, options?: any): SnowpackPlugin {
    const pluginLoc = require.resolve(name, {paths: [process.cwd()]});
    return require(pluginLoc)(config, options);
  }

  // 1. require & load config.scripts
  // TODO: deprecate scripts and move out of this function
  const scriptPlugins: {[pluginName: string]: SnowpackPlugin} = {};
  const buildCommands: Record<string, RunCmd> = {};
  Object.entries(config.scripts).forEach(([target, cmd]) => {
    const {scriptType, extensions} = parseScript(target);

    switch (scriptType) {
      case 'run': {
        runCommands.push({id: target, cmd});
        break;
      }
      case 'build': {
        const pluginName = cmd;
        const plugin = loadPluginFromScript(pluginName);
        if (plugin) {
          // path a: plugin
          if (scriptPlugins[pluginName]) {
            // if plugin already loaded, then add extensions to input/output (unique only, thanks to Set())
            let {input, output} = loadPlugins[pluginName];
            input = [...new Set([...input, ...extensions])];
            output = [...new Set([...output, ...extensions])];
          } else {
            // if plugin not loaded, add it (copying extensions -> input/output)
            scriptPlugins[pluginName] = {
              ...plugin,
              name: pluginName, // script plugins have no name
              input: extensions, // likewise for input/output
              output: extensions,
            };
          }
        } else {
          // path b: command
          extensions.forEach((ext) => {
            buildCommands[ext] = {id: target, cmd};
          });
        }
        break;
      }
      case 'bundle': {
        const bundlerName = cmd;
        bundler = loadPluginFromScript(bundlerName);
        if (!bundler) {
          handleError(
            `Failed to load plugin "${bundlerName}". Only installed Snowpack Plugins are supported for bundle:*`,
          );
          return;
        }
        // TODO: remove with new bundler API
        if (!bundler.name) bundler.name = bundlerName;
        break;
      }
    }
  });

  plugins.push(...Object.values(scriptPlugins));

  // 2. config.plugins
  config.plugins.forEach((ref) => {
    const pluginName = Array.isArray(ref) ? ref[0] : ref;
    const pluginOptions = Array.isArray(ref) ? ref[1] : {};

    if (scriptPlugins[pluginName]) {
      handleError(
        `[${pluginName}]: loaded in both \`scripts\` and \`plugins\`. Please choose one (preferably \`plugins\`).`,
      );
      return;
    }

    const plugin = loadPluginFromConfig(pluginName, pluginOptions);

    // TODO: remove this transition code when all plugins use new API
    if (!plugin.defaultBuildScript && !plugin.input) {
      handleError(`[${pluginName}]: missing input options (see snowpack.dev/plugins)`);
      return;
    }

    if (plugin.defaultBuildScript && !plugin.input) {
      const {extensions} = parseScript(plugin.defaultBuildScript);
      plugin.input = extensions;
      plugin.output = extensions;
    }

    if (!name) {
      plugin.name = pluginName;
    }
    // END transition code

    plugins.push(plugin);
  });

  return {
    plugins,
    bundler,
    runCommands, // TODO: handle this elsewhere (in config?)
    buildCommands, // TODO: remove this when plugins handle building
  };
}

/** create build pipeline from plugin array */
export function createBuildPipeline(plugins: SnowpackPlugin[]): Record<string, SnowpackPlugin[]> {
  const pipeline: Record<string, SnowpackPlugin[]> = {};
  plugins.forEach((plugin) => {
    const inputs = Array.isArray(plugin.input) ? plugin.input : [plugin.input]; // builds only care about inputs (outputs are handled during build)
    inputs.forEach((ext) => {
      if (pipeline[ext]) pipeline[ext].push(plugin);
      else pipeline[ext] = [plugin];
    });
  });
  return pipeline;
}

export interface ExtensionMap {
  input: Record<string, string[]>;
  output: Record<string, string[]>;
}

/** map plugin inputs & outputs to make lookups easier (mostly for dev server) */
export function createPluginExtensionMap(plugins: SnowpackPlugin[]): ExtensionMap {
  const extMap: ExtensionMap = {input: {}, output: {}};
  plugins.forEach((plugin) => {
    const inputs = Array.isArray(plugin.input) ? plugin.input : [plugin.input];
    const outputs = Array.isArray(plugin.output) ? plugin.output : [plugin.output];

    // given a file input ('.svelte'), what will the output extensions be? (['.js', '.css'])
    inputs.forEach((ext) => {
      if (!extMap.input[ext]) extMap.input[ext] = [];
      extMap.input[ext] = [...new Set([...extMap.input[ext], ...outputs])]; // only keep unique extensions
    });

    // given a file output ('.css'), what could the input extension be? (['.css', '.scss', '.svelte'])
    outputs.forEach((ext) => {
      if (!extMap.output[ext]) extMap.output[ext] = [ext]; // an output must always possibly come from itself (not true for inputs)
      extMap.output[ext] = [...new Set([...extMap.output[ext], ...inputs])];
    });
  });
  return extMap;
}
