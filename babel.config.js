// 本番の時にconsole.logを消す設定
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'], // Expoの場合はこれが必須
    env: {
      production: {
        plugins: ['transform-remove-console'],
      },
    },
  };
};