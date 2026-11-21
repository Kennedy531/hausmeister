const { chromium } = require('playwright');
const path = require('path');
const names = ['01-title','02-problem','03-live','04-context','05-connector','06-close'];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (let i = 0; i < names.length; i++) {
    await p.goto('file://' + path.join(__dirname, 'cards.html') + '?n=' + (i + 1));
    await p.waitForLoadState('networkidle').catch(() => {});
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(process.argv[2], names[i] + '.png') });
  }
  console.log(await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).join(',')));
  await b.close();
})();
