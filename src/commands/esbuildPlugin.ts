import {Service, startService} from 'esbuild';
import * as colors from 'kleur/colors';
import path from 'path';
import {SnowpackPlugin} from '../config';
import {checkIsPreact} from './build-util';

let esbuildService: Service | null = null;

export function esbuildPlugin(): SnowpackPlugin {
  return {
    name: '@snowpack/plugin-esbuild',
    input: '.js',
    output: '.js',
    async build({code, filePath}) {
      esbuildService = esbuildService || (await startService());
      const isPreact = checkIsPreact(filePath, code);
      const {js, warnings} = await esbuildService!.transform(code, {
        loader: path.extname(filePath).substr(1) as 'jsx' | 'ts' | 'tsx',
        jsxFactory: isPreact ? 'h' : undefined,
        jsxFragment: isPreact ? 'Fragment' : undefined,
      });
      for (const warning of warnings) {
        console.error(colors.bold('! ') + filePath);
        console.error('  ' + warning.text);
      }
      return js || '';
    },
  };
}

export function stopEsbuild() {
  esbuildService && esbuildService.stop();
}
