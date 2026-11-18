import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const deployment = JSON.parse(await readFile(new URL('../public/deployment.json',import.meta.url),'utf8'))
const target = process.env.EDITION_URL || 'https://chongqianli7.github.io/edition-signal/'
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHROME_CHANNEL || undefined})
try {
  for (const width of [1440,390,320]) {
    const page = await browser.newPage({viewport:{width,height:900},isMobile:width<450,hasTouch:width<450})
    await page.goto(target + '#edition=field-notes-v2')
    await page.getByText('PUBLISHED SHORTLIST',{exact:true}).waitFor({timeout:70000})
    assert.equal(await page.locator('.picks li').count(),2)
    assert.equal(await page.locator('.chart').count(),4)
    const observationLinks = page.getByRole('link',{name:'Observation receipt'})
    assert.equal(await observationLinks.count(),5)
    for (const href of await observationLinks.evaluateAll(links => links.map(link => link.href))) {
      assert.match(new URL(href).pathname,/^\/tx\/0x[0-9a-f]{64}$/i,'Receipt link must use the Explorer transaction route')
    }
    const [clientWidth,scrollWidth] = await page.evaluate(()=>[document.documentElement.clientWidth,document.documentElement.scrollWidth])
    assert.equal(scrollWidth,clientWidth,'Horizontal overflow at ' + width)
    const download = page.waitForEvent('download')
    await page.getByRole('button',{name:'Download edition JSON'}).click()
    const result = JSON.parse(await readFile(await (await download).path(),'utf8'))
    assert.equal(result.key,'field-notes-v2')
    assert.equal(result.contract.toLowerCase(),deployment.address.toLowerCase())
    assert.equal(result.state,'PUBLISHED')
    await page.getByRole('button',{name:'Create test wallet'}).click()
    const first = await page.locator('#identity .address').innerText()
    await page.getByRole('button',{name:'Create test wallet'}).click()
    assert.notEqual(await page.locator('#identity .address').innerText(),first)
    await page.reload()
    await page.getByText('PUBLISHED SHORTLIST',{exact:true}).waitFor()
    assert.equal(await page.getByLabel('Active test wallet').count(),0)
    await page.close()
    console.log('Verified final edition, download, evidence and wallet lifecycle at ' + width + 'px')
  }
} finally {
  await browser.close()
}
