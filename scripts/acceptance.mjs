import assert from 'node:assert/strict'
import {readFileSync, writeFileSync} from 'node:fs'
import {createAccount} from 'genlayer-js'
import {TransactionHashVariant} from 'genlayer-js/types'
import {client, finalized, outcome} from '../network.js'

const [deploymentPath, outputPath] = process.argv.slice(2)
assert(deploymentPath && outputPath, 'Specify the new deployment record and an unused output path.')
const {address} = JSON.parse(readFileSync(deploymentPath))
const legacy = JSON.parse(readFileSync('public/history/deployment-v1.json'))
assert.notEqual(address.toLowerCase(), legacy.address.toLowerCase())
assert.equal(await client.getChainId(), 61999)

const key = 'field-notes-v2'
async function read(at, editionKey=key) {
  const result = await client.readContract({
    address:at, functionName:'edition', args:[editionKey], transactionHashVariant:TransactionHashVariant.LATEST_FINAL,
  })
  return result ? JSON.parse(result) : null
}
const old = await read(legacy.address, 'field-notes-live')
assert.equal(old.state, 'PUBLISHED')
assert.equal(await read(address), null)
const slate = old.rows.map(({title,desk})=>[title,desk])
const start = old.days[0].replace(/^(....)(..)(..)$/, '$1-$2-$3')
const curator = createAccount()
const observer = createAccount()
const results = {address, source:{address:legacy.address,key:'field-notes-live',days:old.days,slots:old.slots,slate}, transactions:[]}
const save = () => writeFileSync(outputPath, JSON.stringify(results,null,2)+'\n')
writeFileSync(outputPath, JSON.stringify(results,null,2)+'\n', {flag:'wx'})

async function send(method, args, account, label=method) {
  const hash = await client.writeContract({address,functionName:method,args:[key,...args],account,value:0n})
  const row = {key,method:label,index:method==='measure'?args[0]:null,actor:account.address.toLowerCase(),hash}
  results.transactions.push(row)
  save()
  console.log(label, row.index, hash)
  const receipt = await finalized(hash)
  Object.assign(row,outcome(receipt,hash))
  save()
  assert.equal(row.status,'FINALIZED')
  assert.equal(row.consensus,'MAJORITY_AGREE')
  assert.equal(receipt.to_address.toLowerCase(),address.toLowerCase())
  return {row,receipt}
}
async function reject(method, args, account, label, reason) {
  const before = await read(address)
  const {row,receipt} = await send(method,args,account,label)
  const vote = receipt.consensus_data.leader_receipt[0]
  console.log(label, JSON.stringify(vote.result).slice(0,2500))
  assert.equal(row.execution,'ERROR')
  assert.equal(vote.result.payload,reason)
  row.reason = reason
  row.resultType = vote.result.status
  assert.equal(row.resultType,'rollback')
  const after = await read(address)
  assert.deepEqual(after,before)
  row.readback = after
  save()
}

assert.equal((await send('freeze',[start,old.slots,JSON.stringify(slate)],curator)).row.execution,'SUCCESS')
const frozen = await read(address)
assert.deepEqual(frozen.days,old.days)
assert.deepEqual(frozen.rows.map(({title,desk})=>[title,desk]),slate)
await Promise.allSettled([
  reject('publish',[],observer,'unauthorized_publish','CURATOR_REQUIRED'),
  reject('publish',[],curator,'early_publish','OBSERVATIONS_PENDING'),
]).then(items=>items.forEach(item=>{if(item.status==='rejected') throw item.reason}))
const measurements = await Promise.allSettled(slate.map(async (_,i)=>{
  const {row} = await send('measure',[i],i===0?observer:createAccount())
  assert.equal(row.execution,'SUCCESS')
}))
for (const item of measurements) if(item.status==='rejected') throw item.reason
const observed = await read(address)
assert.equal(observed.rows.filter(row=>row.status==='MEASURED').length,4)
assert.equal(observed.rows.filter(row=>row.status==='NO_SERIES').length,1)
await reject('measure',[0],observer,'duplicate_measure','ALREADY_MEASURED')
assert.equal((await send('publish',[],curator)).row.execution,'SUCCESS')
results.finalState = await read(address)
assert.equal(results.finalState.state,'PUBLISHED')
assert.equal(results.finalState.order.length,old.slots)
save()
console.log(results.finalState.order.map(i=>results.finalState.rows[i].title))
