const fs = require('fs');
const path = require('path');

function readImportMapFile(explicitPath, dir) {
  if (explicitPath) {
    const explicitImportMap = path.join(process.cwd(), dir, explicitPath);
    return fs.readFileSync(explicitImportMap, {encoding: 'utf8'});
  }
  const localImportMap = path.join(process.cwd(), dir, `import-map.local.json`);
  const defaultImportMap = path.join(process.cwd(), dir, `import-map.json`);
  try {
    return fs.readFileSync(localImportMap, {encoding: 'utf8'});
  } catch (err) {
    // do nothing
  }
  try {
    return fs.readFileSync(defaultImportMap, {encoding: 'utf8'});
  } catch (err) {
    // do nothing
  }
  throw new Error(`Import map not found. Run Snowpack first to generate one.
  ✘ ${localImportMap}
  ✘ ${defaultImportMap}`);
}

function getImportMap(explicitPath, dir) {
  const fileContents = readImportMapFile(explicitPath, dir);
  importMapJson = JSON.parse(fileContents);
  return importMapJson;
}

function rewriteImport(importMap, imp, dir, shouldAddMissingExtension) {
  const isSourceImport = imp.startsWith('/') || imp.startsWith('.') || imp.startsWith('\\');
  const isRemoteImport = imp.startsWith('http://') || imp.startsWith('https://');
  const mappedImport = importMap.imports[imp];
  if (mappedImport) {
    if (mappedImport.startsWith('http://') || mappedImport.startsWith('https://')) {
      return mappedImport;
    } else {
      return path.posix.join('/', dir, mappedImport);
    }
  }
  if (isRemoteImport) {
    return imp;
  }
  if (!isSourceImport && !mappedImport) {
    console.log(`warn: bare import "${imp}" not found in import map, ignoring...`);
    return imp;
  }
  if (isSourceImport && shouldAddMissingExtension && !path.extname(imp)) {
    return imp + '.js';
  }
  return imp;
}

/**
 * BABEL OPTIONS:
 *   dir                - The web_modules installed location once hosted on the web.
 *                        Defaults to "web_modules", which translates package imports to "/web_modules/PACKAGE_NAME".
 *   importMap          - The name/location of the import-map.json file generated by Snowpack.
 *                        Relative to the dir path.
 *                        Defaults to "import-map.local.json", "import-map.json" in that order.
 *   optionalExtensions - Adds any missing JS extensions to local/relative imports. Support for these
 *                        partial imports is missing in the browser and being phased out of Node.js, but
 *                        this can be a useful option for migrating an old project to Snowpack.
 */
module.exports = function pikaWebBabelTransform(
  {types: t, env},
  {optionalExtensions, dir, addVersion, importMap} = {},
) {
  // Default options
  optionalExtensions = optionalExtensions || false;
  dir = dir || 'web_modules';
  // Deprecation warnings
  if (addVersion) {
    console.warn(
      'warn: "addVersion" option is now built into Snowpack and on by default. The Babel option is no longer needed.',
    );
  }
  // Plugin code
  return {
    pre() {
      this.importMapJson = getImportMap(importMap, dir);
    },
    visitor: {
      CallExpression(path, {file, opts}) {
        if (path.node.callee.type !== 'Import') {
          return;
        }
        const [source] = path.get('arguments');
        if (source.type !== 'StringLiteral') {
          /* Should never happen */
          return;
        }
        source.replaceWith(
          t.stringLiteral(
            rewriteImport(this.importMapJson, source.node.value, dir, optionalExtensions),
          ),
        );
      },
      'ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration'(path, {file, opts}) {
        const source = path.get('source');
        // An export without a 'from' clause
        if (!source.node) {
          return;
        }
        source.replaceWith(
          t.stringLiteral(
            rewriteImport(this.importMapJson, source.node.value, dir, optionalExtensions),
          ),
        );
      },
    },
  };
};
