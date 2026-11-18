// make-icons.js  →  node make-icons.js
const sharp = require('sharp');
const out = './assets/images';
const bg = '#ffffff'; // icon background (iOS needs it opaque)

(async () => {
  const logo = (size) =>
    sharp('logo.png').resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });

  // iOS/main icon: 1024, logo ~80% of canvas, flattened onto a solid color
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: bg } })
    .composite([{ input: await logo(820).png().toBuffer(), gravity: 'center' }])
    .flatten({ background: bg })
    .png().toFile(`${out}/icon.png`);

  // Android adaptive foreground: transparent, logo inside the ~66% safe zone
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await logo(680).png().toBuffer(), gravity: 'center' }])
    .png().toFile(`${out}/adaptive-foreground.png`);

  // Splash and favicon
  await logo(1024).png().toFile(`${out}/splash-icon.png`);
  await logo(256).png().toFile(`${out}/favicon.png`);
  console.log('done');
})();