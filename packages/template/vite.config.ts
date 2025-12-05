import markdown from '@motion-canvas/internal/vite/markdown-literals';
import preact from '@preact/preset-vite';
import path from 'path';
import {defineConfig} from 'vite';
import ffmpeg from '../ffmpeg/server';
import motionCanvas from '../vite-plugin/src/main';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@motion-canvas/ui',
        replacement: '@motion-canvas/ui/src/main.tsx',
      },
      {
        find: '@motion-canvas/2d/editor',
        replacement: '@motion-canvas/2d/src/editor',
      },
      {
        find: '@motion-canvas/ffmpeg/lib/client',
        replacement: '../ffmpeg/client/index.ts',
      },
      {
        find: /^\/ffmpeg\/client\/index\.ts$/,
        replacement: path.resolve(__dirname, '../ffmpeg/client/index.ts'),
      },
      {
        find: '@motion-canvas/2d/src/lib/jsx-runtime',
        replacement: path.resolve(__dirname, '../2d/src/lib/jsx-runtime.ts'),
      },
      {
        find: '@motion-canvas/2d/src/lib/jsx-dev-runtime',
        replacement: path.resolve(
          __dirname,
          '../2d/src/lib/jsx-dev-runtime.ts',
        ),
      },
      {
        find: /@motion-canvas\/2d(\/lib)?/,
        replacement: '@motion-canvas/2d/src/lib',
      },
      {find: '@motion-canvas/core', replacement: '@motion-canvas/core/src'},
    ],
  },
  plugins: [
    markdown(),
    preact({
      include: [
        /packages\/ui\/src\/(.*)\.tsx?$/,
        /packages\/2d\/src\/editor\/(.*)\.tsx?$/,
      ],
    }),
    {
      name: 'resolve-jsx-runtime',
      resolveId(id) {
        if (id === '@motion-canvas/2d/src/lib/jsx-runtime') {
          return path.resolve(__dirname, '../2d/src/lib/jsx-runtime.ts');
        }
        if (id === '@motion-canvas/2d/src/lib/jsx-dev-runtime') {
          return path.resolve(__dirname, '../2d/src/lib/jsx-dev-runtime.ts');
        }
        if (
          id === '@motion-canvas/ffmpeg/lib/client' ||
          id === '/ffmpeg/client/index.ts'
        ) {
          return path.resolve(__dirname, '../ffmpeg/client/index.ts');
        }
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/ffmpeg/client/index.ts') {
            req.url =
              '/@fs/' + path.resolve(__dirname, '../ffmpeg/client/index.ts');
          }
          next();
        });
      },
    },
    motionCanvas({
      buildForEditor: true,
    }),
    ffmpeg(),
  ],
  build: {
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
