import {createAccount} from 'genlayer-js'
import {formatEther} from 'viem'
import {client, explorer, finalized, outcome} from './network.js'
import './style.css'

const $ = id => document.getElementById(id)
const desks = ['Science', 'Culture', 'Places', 'Technology']
const names = {PENDING:'Evidence needed', MEASURED:'Measured', NO_SERIES:'No published series', SELECTED:'Selected', DESK_LIMIT:'Desk already represented', SLOT_LIMIT:'Edition slots filled', LOW_BASELINE:'Below 100 baseline views'}
const buttonNames = {freeze:'Freeze editorial slate', measure:'Measure Wikimedia readership', publish:'Publish shortlist'}
const format = new Intl.NumberFormat('en')
const wallets = []
const receipts = []
let signer
let deployment
let examples = []
let key = ''
let edition
let busy = false
let readId = 0
let candidateSequence = 0

function el(tag, text, css) {
  const item = document.createElement(tag)
  if (text !== undefined) item.textContent = text
  if (css) item.className = css
  return item
}
function link(text, href) {
  const anchor = el('a', text)
  anchor.href = href
  return anchor
}
function paragraph(child) {
  const item = el('p')
  item.append(child)
  return item
}
function button(text, callback) {
  const item = el('button', text)
  item.type = 'button'
  item.disabled = busy || !signer
  item.onclick = callback
  return item
}
function appendCandidate(title = '', desk = 'Science') {
  const row = el('div', undefined, 'candidate-fields')
  const input = el('input')
  const select = el('select')
  const remove = el('button', 'Remove')
  const index = ++candidateSequence
  input.setAttribute('aria-label', 'Candidate title ' + index)
  input.placeholder = 'Ada_Lovelace'
  input.required = true
  input.maxLength = 80
  input.value = title
  select.setAttribute('aria-label', 'Candidate desk ' + index)
  for (const value of desks) select.append(el('option', value))
  select.value = desk
  remove.type = 'button'
  remove.onclick = () => { row.remove(); renderForm() }
  row.append(input, select, remove)
  $('fields').append(row)
  renderForm()
}
function renderForm() {
  const count = $('fields').children.length
  $('add').disabled = busy || count === 6
  $('lock').disabled = busy || !signer || !deployment || count < 2
  for (const remove of $('fields').querySelectorAll('button')) remove.disabled = busy || count <= 2
}
function renderWallet() {
  const panel = $('identity')
  panel.replaceChildren()
  $('wallet').disabled = busy || wallets.length >= 3
  $('reset').disabled = busy
  $('reset').hidden = !wallets.length
  if (signer) {
    const select = el('select')
    select.setAttribute('aria-label', 'Active test wallet')
    wallets.forEach((wallet, index) => {
      const option = el('option', 'Test wallet ' + (index + 1))
      option.value = wallet.address
      option.selected = wallet === signer
      select.append(option)
    })
    select.disabled = busy
    select.onchange = () => { signer = wallets.find(wallet => wallet.address === select.value); renderWallet(); renderBoard() }
    const balance = el('p', 'Checking balance…')
    panel.append(select, el('p', signer.address, 'address'), balance)
    client.getBalance({address:signer.address}).then(value => { balance.textContent = formatEther(value) + ' test GEN' })
      .catch(() => { balance.textContent = 'Balance unavailable' })
  }
  renderForm()
}
function ticket(title, hash) {
  return link(title, explorer + '/tx/' + hash)
}
function drawChart(row, days) {
  const chart = el('div', undefined, 'chart')
  chart.setAttribute('aria-label', 'Daily Wikimedia views, oldest to newest')
  chart.setAttribute('role', 'img')
  const peak = Math.max(...row.daily, 1)
  row.daily.forEach((count, index) => {
    const bar = el('span')
    bar.style.height = (count * 100 / peak) + '%'
    bar.title = days[index] + ' UTC · ' + format.format(count) + ' views'
    chart.append(bar)
  })
  return chart
}
function renderBoard() {
  const board = $('board')
  board.replaceChildren()
  if (!edition) return
  const section = el('section', undefined, 'edition')
  const day = value => value.replace(/^(....)(..)(..)$/, '$1-$2-$3')
  section.append(el('p', edition.state === 'PUBLISHED' ? 'PUBLISHED SHORTLIST' : 'SLATE FROZEN', 'stamp'),
    el('h2', key.replaceAll('-', ' ')), el('p', day(edition.days[0]) + ' → ' + day(edition.days.at(-1)) + ' UTC · ' + edition.slots + ' story slots', 'meta'),
    el('p', 'Curator ' + edition.owner, 'address'))
  const match = [...examples, ...receipts].filter(item => item.key === key && item.execution === 'SUCCESS')
  for (const item of match.filter(item => item.method !== 'measure')) section.append(paragraph(ticket(item.method + ' receipt ↗', item.hash)))
  if (edition.state === 'PUBLISHED') {
    const picks = el('ol', undefined, 'picks')
    for (const i of edition.order) picks.append(el('li', edition.rows[i].title.replaceAll('_', ' ')))
    section.append(picks, el('p', 'Rank by relative weekly lift, then recent views and canonical title. A baseline of 100 views is required, with one selected story per desk.'))
    section.append(button('Download edition JSON', exportEdition))
    section.lastElementChild.disabled = false
  } else {
    const owner = signer?.address.toLowerCase() === edition.owner
    const waiting = edition.rows.some(row => row.status === 'PENDING')
    const eligible = edition.rows.some(row => row.daily.slice(0, 7).reduce((a, b) => a + b, 0) >= 100)
    section.append(el('p', 'Anyone with a test wallet can submit a measurement. The curator publishes once all candidates have a result and at least one qualifies.'))
    if (owner && !waiting && eligible) section.append(button('Publish shortlist', () => submit('publish', [key])))
  }
  const stories = el('div', undefined, 'stories')
  edition.rows.forEach((row, index) => {
    const card = el('article', undefined, row.decision === 'SELECTED' ? 'story selected' : 'story')
    card.append(el('p', row.desk + ' · ' + names[row.decision ?? row.status], 'stamp'), el('h3', row.title.replaceAll('_', ' ')))
    if (row.daily.length) {
      const baseline = row.daily.slice(0, 7).reduce((a, b) => a + b, 0)
      const recent = row.daily.slice(7).reduce((a, b) => a + b, 0)
      const bps = Math.floor((recent - baseline) * 10000 / Math.max(baseline, 1))
      const stats = el('div', undefined, 'stats')
      stats.append(el('span', 'Baseline ' + format.format(baseline)), el('span', 'Recent ' + format.format(recent)), el('strong', (bps >= 0 ? '+' : '') + (bps / 100).toFixed(2) + '%'))
      card.append(drawChart(row, edition.days), stats)
    }
    if (row.source) {
      card.append(paragraph(link('Wikimedia series ↗', row.source)))
      card.append(el('p', 'Observed by ' + row.observer, 'address'))
    }
    const measurement = match.find(item => item.method === 'measure' && item.index === index)
    if (measurement) card.append(paragraph(ticket('Observation receipt ↗', measurement.hash)))
    if (edition.state === 'FROZEN' && row.status !== 'MEASURED') card.append(button(row.status === 'NO_SERIES' ? 'Retry ' + row.title : 'Measure ' + row.title, () => submit('measure', [key, index])))
    stories.append(card)
  })
  section.append(stories)
  board.append(section)
}
function exportEdition() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({key, contract:deployment.address, ...edition}, null, 2)], {type:'application/json'}))
  const download = link('Download', url)
  download.download = key + '.json'
  download.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}
async function open(requested) {
  const id = ++readId
  key = requested
  edition = null
  $('heading').textContent = 'Edition desk'
  renderBoard()
  $('read-status').textContent = 'Reading finalized chain state…'
  try {
    const payload = await client.readContract({address:deployment.address, functionName:'edition', args:[requested], stateStatus:'finalized'})
    if (id !== readId) return
    edition = payload ? JSON.parse(payload) : null
    $('read-status').textContent = edition ? '' : 'No edition exists with this key.'
    renderBoard()
  } catch {
    if (id === readId) $('read-status').textContent = 'Could not read the finalized edition. Try again.'
  }
}
function route() {
  const requested = new URLSearchParams(location.hash.slice(1)).get('edition')
  if (!requested || !deployment) return
  $('key').value = requested
  open(requested)
}
function navigate(requested) {
  const hash = '#edition=' + encodeURIComponent(requested)
  if (location.hash === hash) route()
  else location.hash = hash
}
function feedback(message) {
  $('feedback').textContent = message
}
async function submit(method, args) {
  if (busy || !signer) return
  busy = true
  const account = signer
  renderWallet()
  renderBoard()
  const dialog = $('confirm')
  $('intent').textContent = buttonNames[method] + '\n' + args[0] + (method === 'measure' ? ' · ' + edition.rows[args[1]].title : '') + '\nStable Studionet (61999)\n' + account.address
  dialog.returnValue = ''
  dialog.showModal()
  await new Promise(resolve => dialog.addEventListener('close', resolve, {once:true}))
  let hash
  try {
    if (dialog.returnValue !== 'send') return
    feedback('Signing and submitting…')
    hash = await client.writeContract({address:deployment.address, functionName:method, args, account, value:0n})
    const receipt = ticket('Submitted transaction ↗', hash)
    const row = el('li')
    row.append(receipt)
    $('receipts').prepend(row)
    feedback('Waiting for consensus and finalization…')
    const result = outcome(await finalized(hash), hash)
    receipt.textContent = method + ' · ' + result.status + ' / ' + result.execution + ' ↗'
    receipts.push({key:args[0], method, index:args[1], ...result})
    if (result.status !== 'FINALIZED' || result.execution !== 'SUCCESS') {
      feedback('Operation rejected. ' + (result.reason ?? 'See the receipt for the execution result.'))
      return
    }
    feedback('Finalized successfully.')
    if (method === 'freeze') navigate(args[0])
    else if (key === args[0]) await open(key)
  } catch {
    feedback(hash ? 'Transaction submitted. Check the Explorer before retrying.' : 'No transaction hash was returned.')
  } finally {
    busy = false
    renderWallet()
    renderBoard()
  }
}
$('lookup').onsubmit = event => { event.preventDefault(); navigate($('key').value.trim().toLowerCase()) }
$('freeze').onsubmit = event => {
  event.preventDefault()
  const entries = [...$('fields').children].map(row => [row.querySelector('input').value.trim().replaceAll(' ', '_'), row.querySelector('select').value])
  if (!entries.every(([title]) => /^[A-Z0-9][A-Za-z0-9_()-]{0,79}$/.test(title))) return feedback('Use canonical English article titles, starting with a capital or digit.')
  submit('freeze', [$('slug').value.trim().toLowerCase(), $('date').value, Number($('slots').value), JSON.stringify(entries)])
}
$('wallet').onclick = () => { signer = createAccount(); wallets.push(signer); renderWallet(); renderBoard() }
$('reset').onclick = () => { wallets.length = 0; signer = undefined; renderWallet(); renderBoard(); feedback('Temporary wallets removed.') }
$('add').onclick = () => appendCandidate()
document.querySelector('.jump').addEventListener('click', event => {
  event.preventDefault()
  const requested = new URLSearchParams(event.currentTarget.hash.slice(1)).get('edition')
  navigate(requested)
  $('desk').scrollIntoView()
})
window.addEventListener('hashchange', route)
appendCandidate()
appendCandidate()
$('date').max = new Date(Date.now() - 16 * 86400000).toISOString().slice(0, 10)

async function initialize() {
  try {
    const response = await fetch('./deployment.json', {cache:'no-cache'})
    if (!response.ok) throw new Error('Deployment unavailable')
    deployment = await response.json()
    const ledger = await fetch('./evidence.json', {cache:'no-cache'})
    if (ledger.ok && ledger.headers.get('content-type')?.includes('json')) examples = await ledger.json()
    $('explorer').href = explorer + '/address/' + deployment.address
    renderWallet()
    route()
  } catch {
    $('read-status').textContent = 'The deployed edition contract is unavailable.'
  }
}
initialize()
