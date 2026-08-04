import { defineConfig } from 'vitepress';

export default defineConfig({
  title: '3DGS Web Engine',
  description: '轻量级 Web 3DGS 渲染引擎与漫游框架',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,

  vite: {
    server: {
      port: 5178,
    },
  },

  head: [
    ['meta', { name: 'theme-color', content: '#3c8772' }],
  ],

  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/getting-started' },
      { text: 'API', link: '/api/core' },
      { text: '示例', link: '/examples/basic' },
      { text: 'GitHub', link: 'https://github.com/sacrtap/3dgs' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '安装', link: '/guide/installation' },
            { text: '配置参考', link: '/guide/configuration' },
          ],
        },
        {
          text: '核心概念',
          items: [
            { text: '架构设计', link: '/guide/architecture' },
            { text: '插件系统', link: '/guide/plugins' },
            { text: '渲染器', link: '/guide/renderer' },
            { text: 'Shader 注入', link: '/guide/shader-injection' },
          ],
        },
        {
          text: '进阶',
          items: [
            { text: '数据转换', link: '/guide/data-convert' },
            { text: '性能优化', link: '/guide/performance' },
            { text: '部署指南', link: '/guide/deployment' },
            { text: '插件开发', link: '/guide/plugin-dev' },
            { text: '常见问题', link: '/guide/faq' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: '@3dgs/core', link: '/api/core' },
            { text: '@3dgs/renderer-three', link: '/api/renderer-three' },
            { text: '@3dgs/plugins', link: '/api/plugins' },
            { text: '@3dgs/convert', link: '/api/convert' },
            { text: '@3dgs/react', link: '/api/react' },
            { text: '@3dgs/vue', link: '/api/vue' },
          ],
        },
      ],
      '/examples/': [
        {
          text: '示例',
          items: [
            { text: '基础嵌入', link: '/examples/basic' },
            { text: '多场景漫游', link: '/examples/multi-scene' },
            { text: 'React 集成', link: '/examples/react' },
            { text: 'Vue 集成', link: '/examples/vue' },
            { text: '自定义热点', link: '/examples/hotspot' },
            { text: 'Shader 效果', link: '/examples/shader' },
            { text: '数据转换', link: '/examples/convert' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/sacrtap/3dgs' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 sacrtap',
    },

    outline: {
      level: [2, 3],
    },

    search: {
      provider: 'local',
    },
  },
});
