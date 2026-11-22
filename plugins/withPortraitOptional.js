// Google Play: приложение только вертикальное, из-за этого Play требует
// android.hardware.screen.portrait и блокирует выпуск. Делаем функцию необязательной.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withPortraitOptional(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const name = 'android.hardware.screen.portrait';
    manifest['uses-feature'] = (manifest['uses-feature'] || []).filter(
      (f) => f.$['android:name'] !== name
    );
    manifest['uses-feature'].push({ $: { 'android:name': name, 'android:required': 'false' } });
    return cfg;
  });
};
