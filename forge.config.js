'use strict';

const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'sf-bitcoin-devs-wallet',
    appBundleId: 'org.sfbitcoindevs.wallet',
    appCategoryType: 'public.app-category.finance',
    ignore: [
      /^\/(?:\.git|ChromeApp|lib|node_modules|out|spec|tests|__pycache__)(?:\/|$)/,
      /^\/desktop\/tests(?:\/|$)/,
      /^\/(?:\.gitignore|\.npmrc|SpecRunner\.html|forge\.config\.js|local_server\.py|pnpm-lock\.yaml|pnpm-workspace\.yaml|README\.md)$/
    ]
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'sf_bitcoin_devs_wallet',
        authors: 'SF Bitcoin Devs contributors',
        description: 'Local Bitcoin Core and Fulcrum desktop wallet'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'darwin']
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        format: 'ULFO'
      }
    }
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: process.platform === 'darwin' && process.arch === 'arm64',
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};
