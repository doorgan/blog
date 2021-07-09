module.exports = {
  syntax: 'postcss-scss',
  plugins: [
    require('postcss-node-sass')({
      outputStyle: 'compressed'
    }),
    require(`autoprefixer`),
    require('cssnano')({
      preset: 'default',
    }),
  ],
};