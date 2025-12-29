import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import copy from 'rollup-plugin-copy';

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
      sourcemap: true,
    },
    external: ['fs', 'path', 'http', 'ws', 'zod', 'ai', '@ai-sdk/openai', '@ai-sdk/anthropic', '@ai-sdk/google', '@ai-sdk/xai'],
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        compilerOptions: {
          module: 'esnext',
        },
      }),
      copy({
        targets: [
          { src: 'src/core/wizard/ui/*', dest: 'dist/ui' }
        ]
      }),
    ],
  },
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es',
    },
    external: ['fs', 'path', 'http', 'ws', 'zod', 'ai', '@ai-sdk/openai', '@ai-sdk/anthropic', '@ai-sdk/google', '@ai-sdk/xai'],
    plugins: [
      dts(),
    ],
  },
];