import fs from 'fs';
import path from 'path';
import yargs from 'yargs-parser';
import {SnowpackConfig} from '../config';
import {getExt, ImportMap, replaceExt} from '../util';
import {loadPlugins} from '../plugins';
const URL_HAS_PROTOCOL_REGEX = /^(\w+:)?\/\//;

interface ImportResolverOptions {
  fileLoc: string;
  webModulesPath: string;
  dependencyImportMap: ImportMap | null | undefined;
  isDev: boolean;
  isBundled: boolean;
  config: SnowpackConfig;
}

/** key/value (src/dest) of mounted directories from config */
export function getMountedDirs(config: SnowpackConfig) {
  function handleError(msg: string) {
    console.error(`[error]: ${msg}`);
    process.exit(1);
  }

  const mountedDirs: Record<string, string> = {};

  for (const [id, cmd] of Object.entries(config.scripts)) {
    if (!id.startsWith('mount:')) {
      continue;
    }

    const cmdArr = cmd.split(/\s+/);
    if (cmdArr[0] !== 'mount') {
      handleError(`scripts[${id}] must use the mount command`);
    }
    cmdArr.shift();
    const {to, _} = yargs(cmdArr);
    if (_.length !== 1) {
      handleError(`scripts[${id}] must use the format: "mount dir [--to /PATH]"`);
    }
    if (to && to[0] !== '/') {
      handleError(`scripts[${id}]: "--to ${to}" must be a URL path, and start with a "/"`);
    }
    let dirDisk = cmdArr[0];
    const dirUrl = to || `/${cmdArr[0]}`;

    const fromDisk = path.posix.normalize(dirDisk + '/');
    const toUrl = path.posix.normalize(dirUrl + '/');

    mountedDirs[fromDisk] = toUrl;
  }

  return mountedDirs;
}

/**
 * Create a import resolver function, which converts any import relative to the given file at "fileLoc"
 * to a proper URL. Returns false if no matching import was found, which usually indicates a package
 * not found in the import map.
 */
export function createImportResolver({
  fileLoc,
  webModulesPath,
  dependencyImportMap,
  isDev,
  isBundled,
  config,
}: ImportResolverOptions) {
  return function importResolver(spec: string): string | false {
    if (URL_HAS_PROTOCOL_REGEX.test(spec)) {
      return spec;
    }

    const cwd = path.resolve(process.cwd(), fileLoc);

    if (matchedDir) {
      const [fromDisk, toUrl] = matchedDir;
      const spec = resolveSourceSpecifier(spec, isBundled);
      spec = spec.replace(fromDisk, toUrl);
      return spec;
    }
    if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) {
      spec = resolveSourceSpecifier(spec, importStats, isBundled);
      return spec;
    }
    if (dependencyImportMap && dependencyImportMap.imports[spec]) {
      // if baseURL is remote, handle that outside of path.posix.join()
      const protocolMatch = config.buildOptions.baseUrl.match(URL_HAS_PROTOCOL_REGEX);
      const protocol = (protocolMatch && protocolMatch[0]) || '';
      const baseUrl = config.buildOptions.baseUrl.replace(URL_HAS_PROTOCOL_REGEX, '');

      let resolvedImport = isDev
        ? path.posix.resolve(webModulesPath, dependencyImportMap.imports[spec])
        : `${protocol}${path.posix.join(
            baseUrl,
            webModulesPath,
            dependencyImportMap.imports[spec],
          )}`;
      const extName = path.extname(resolvedImport);
      if (!isBundled && extName && extName !== '.js') {
        resolvedImport = resolvedImport + '.proxy.js';
      }
      return resolvedImport;
    }
    return false;
  };
}

/** Resolve URL to source file on disk */
export function urlToFile(
  url: string,
  {config, cwd = process.cwd()}: {config: SnowpackConfig; cwd: string},
) {
  const {plugins} = loadPlugins(config);
  const mountedDirs = getMountedDirs(config);

  interface ExtensionMap {
    input: Record<string, string[]>;
    output: Record<string, string[]>;
  }

  // map plugin inputs & outputs to make lookups easier
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

  // iterate through mounted directories to find match
  const {baseExt, expandedExt} = getExt(url);
  let locOnDisk: string | undefined;
  const lookups: string[] = []; // keep track of attempted lookups in case of 404
  const possibleDirs = Object.entries(mountedDirs).filter(([, toUrl]) => url.startsWith(toUrl));
  for (const [fromDisk] of possibleDirs) {
    for (const ext of extMap.output[expandedExt || baseExt]) {
      const locationAttempt = path.join(cwd, fromDisk, replaceExt(url, ext));
      lookups.push(locationAttempt);
      if (fs.existsSync(locationAttempt)) {
        locOnDisk = locationAttempt;
        break;
      }
    }
  }

  return {locOnDisk, lookups};
}
