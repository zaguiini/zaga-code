module.exports = {
  appId: 'com.zaga.code',
  productName: 'Zaga Code',
  directories: { output: 'release' },
  files: ['dist/**', '!dist/mac-arm64{,/**}', '!dist/*.yml', '!dist/*.yaml', 'node_modules/**/*'],
  extraResources: [
    { from: '../web/dist', to: 'web' },
    { from: 'bin/zaga-prod', to: 'bin/zaga' },
  ],
  mac: { category: 'public.app-category.developer-tools' },
  linux: { category: 'Development' },
}
