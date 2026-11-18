import assert from 'node:assert/strict'
import {readFileSync, writeFileSync} from 'node:fs'
import {createAccount} from 'genlayer-js'
import {client, finalized, outcome} from '../network.js'

const address = JSON.parse(readFileSync('public/deployment.json')).address
const key = process.argv[2]
if (!key) throw Error('Specify an unused edition key.')
const curator = createAccount()
const slate = [['Ada_Lovelace','Science'],['Mars','Science'],['Aurora','Places'],['Impressionism','Culture'],['Edition_Signal_No_Such_Article_7248','Technology']]
const entries = []
const read = async () => JSON.parse(await client.readContract({address,functionName:'edition',args:[key],stateStatus:'finalized'}) || 'null')
assert.equal(await read(), null)
async function send(functionName, args, account, expectation, label = functionName) {
  const hash = await client.writeContract({address, functionName, args:[key,...args], account, value:0n})
  console.log(label + ' submitted ' + hash)
  const row = {key, method:label, index:functionName === 'measure' ? args[0] : null,
    actor:account.address.toLowerCase(), ...outcome(await finalized(hash),hash)}
  entries.push(row)
  console.log(JSON.stringify(row))
  assert.equal(row.status,'FINALIZED')
  assert.equal(row.execution,expectation)
}
try {
  await send('freeze',['2026-10-01',2,JSON.stringify(slate)],curator,'SUCCESS')
  await Promise.all([
    send('publish',[],createAccount(),'ERROR','unauthorized_publish'),
    send('publish',[],curator,'ERROR','early_publish'),
    ...slate.map((_,i) => send('measure',[i],createAccount(),'SUCCESS')),
  ])
  const observed = await read()
  assert.equal(observed.rows[4].status,'NO_SERIES')
  assert(observed.rows.slice(0,4).every(row => row.daily.length === 14))
  await send('measure',[0],createAccount(),'ERROR','duplicate_measure')
  await send('publish',[],curator,'SUCCESS')
  const result = await read()
  assert.equal(result.state,'PUBLISHED')
  assert.equal(result.order.length,2)
  console.log(JSON.stringify({order:result.order.map(index=>result.rows[index].title), result}))
} finally {
  writeFileSync('public/evidence.json', JSON.stringify(entries, null, 2) + '\n')
}
