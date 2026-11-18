import {TransactionHashVariant} from 'genlayer-js/types'
import {abi} from 'genlayer-js'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {chain, client, finalized, outcome} from '../network.js'

const deployment = JSON.parse(readFileSync('public/deployment.json'))
const evidence = JSON.parse(readFileSync('public/evidence.json'))
const legacy = JSON.parse(readFileSync('public/history/deployment-v1.json'))
const legacyEvidence = JSON.parse(readFileSync('public/history/evidence-v1.json'))
const rehearsal = JSON.parse(readFileSync('public/history/rehearsal-v2.json'))
const acceptance = JSON.parse(readFileSync('public/acceptance.json'))
const key = 'field-notes-v2'
const expectedRejections = {
  unauthorized_publish:'CURATOR_REQUIRED',
  early_publish:'OBSERVATIONS_PENDING',
  duplicate_measure:'ALREADY_MEASURED',
}
assert.equal(chain.id,61999)
assert.equal(await client.getChainId(),61999)
assert.notEqual(deployment.address.toLowerCase(),legacy.address.toLowerCase())
assert.equal(rehearsal.address,deployment.address)

async function checkReceipts(record, ledger, active) {
  const deployed = await finalized(record.hash)
  assert.deepEqual(outcome(deployed,record.hash),{
    hash:record.hash,status:'FINALIZED',consensus:'MAJORITY_AGREE',execution:'SUCCESS',reason:null,
  })
  assert.equal(deployed.to_address.toLowerCase(),record.address.toLowerCase())
  const rejections = []
  for (const item of ledger) {
    const receipt = await finalized(item.hash)
    const actual = outcome(receipt,item.hash)
    for (const field of ['hash','status','consensus','execution','reason']) assert.equal(actual[field],item[field])
    assert.equal(actual.status,'FINALIZED')
    assert.equal(actual.consensus,'MAJORITY_AGREE')
    assert.equal(receipt.to_address.toLowerCase(),record.address.toLowerCase())
    assert.equal(receipt.from_address.toLowerCase(),item.actor)
    if (active) {
      const call = abi.calldata.decode(Buffer.from(receipt.data.calldata.base64,'base64'))
      const method = expectedRejections[item.method]
        ? item.method === 'duplicate_measure' ? 'measure' : 'publish'
        : item.method
      assert.equal(call.get('method'),method)
      assert.equal(call.get('args')[0],item.key)
      if (method === 'measure') assert.equal(Number(call.get('args')[1]),item.index)
    }
    if (actual.execution !== 'ERROR') continue
    if (active) {
      const vote = receipt.consensus_data.leader_receipt[0].result
      assert.equal(vote.status,'rollback')
      assert.equal(Buffer.from(vote.raw,'base64')[0],1)
      assert.equal(vote.payload,expectedRejections[item.method])
      assert.equal(actual.resultType,item.resultType)
    }
    rejections.push({key:item.key,method:item.method,hash:item.hash,kind:actual.resultType,reason:actual.reason})
  }
  return rejections
}
const [v2Failures, legacyFailures] = await Promise.all([
  checkReceipts(deployment,[...evidence,...rehearsal.transactions],true),
  checkReceipts(legacy,legacyEvidence,false),
])
const failureReasons = v2Failures.filter(row=>row.key===key)
assert.deepEqual(failureReasons.map(row=>row.method).sort(),Object.keys(expectedRejections).sort())
const source = JSON.parse(await client.readContract({
  address:legacy.address,functionName:'edition',args:[acceptance.source.key],
  transactionHashVariant:TransactionHashVariant.LATEST_FINAL,
}))
assert.equal(source.state,'PUBLISHED')
for (const row of evidence.filter(item=>item.execution==='ERROR')) {
  const checkpoint = acceptance.rejections[row.method]
  assert.equal(checkpoint.state,'FROZEN')
  if (row.method === 'duplicate_measure') assert.equal(checkpoint.rows[0].status,'MEASURED')
  else assert(checkpoint.rows.every(item=>item.status==='PENDING'))
}
assert.equal(acceptance.source.address,legacy.address)
assert.deepEqual(acceptance.source.days,source.days)
assert.equal(acceptance.source.slots,source.slots)
assert.deepEqual(acceptance.source.slate,source.rows.map(({title,desk})=>[title,desk]))
const result = JSON.parse(await client.readContract({
  address:deployment.address,functionName:'edition',args:[key],transactionHashVariant:TransactionHashVariant.LATEST_FINAL,
}))
assert.equal(result.state,'PUBLISHED')
assert.equal(acceptance.address,deployment.address)
assert.deepEqual(result,acceptance.finalState)
assert.deepEqual(result.days,source.days)
assert.equal(result.slots,source.slots)
assert.deepEqual(result.rows.map(({title,desk})=>[title,desk]),acceptance.source.slate)
assert.equal(result.rows.filter(row=>row.status==='NO_SERIES').length,1)

const sourceDrift = []
const ranked = []
for (const [index,row] of result.rows.entries()) {
  assert.equal(row.daily.length, row.status === 'MEASURED' ? 14 : 0)
  if (row.status === 'MEASURED') {
    assert(row.daily.every(value=>Number.isInteger(value) && value>=0))
    assert.equal(row.baseline,row.daily.slice(0,7).reduce((sum,value)=>sum+value,0))
    assert.equal(row.recent,row.daily.slice(7).reduce((sum,value)=>sum+value,0))
    assert.equal(row.lift_bps,Math.floor((row.recent-row.baseline)*10000/Math.max(row.baseline,1)))
    if(row.baseline>=100) ranked.push({index,...row})
  }

  let response
  try {
    response = await fetch(row.source,{signal:AbortSignal.timeout(18000)})
  } catch (error) {
    sourceDrift.push({title:row.title,kind:'SOURCE_UNAVAILABLE',detail:String(error)})
    continue
  }
  if (row.status === 'NO_SERIES') {
    if (response.status !== 404) {
      sourceDrift.push({title:row.title,kind:'NO_SERIES_STATUS_CHANGED',currentStatus:response.status})
    }
    continue
  }
  if (response.status !== 200) {
    sourceDrift.push({title:row.title,kind:'SOURCE_STATUS_CHANGED',currentStatus:response.status})
    continue
  }
  try {
    const body = await response.json()
    const items = body.items.sort((a,b)=>a.timestamp.localeCompare(b.timestamp))
    const timestamps = items.map(item=>item.timestamp)
    const expectedTimestamps = result.days.map(day=>day+'00')
    const metadataValid = items.every(item =>
      item.article===row.title && item.project==='en.wikipedia' &&
      item.access==='all-access' && item.agent==='user' &&
      item.granularity==='daily' && Number.isInteger(item.views) && item.views>=0
    )
    if (JSON.stringify(timestamps)!==JSON.stringify(expectedTimestamps) || !metadataValid) {
      sourceDrift.push({title:row.title,kind:'SOURCE_SHAPE_CHANGED'})
      continue
    }
    const currentDaily = items.map(item=>item.views)
    const changed = currentDaily.flatMap((value,i)=>value===row.daily[i]?[]:[{
      day:result.days[i],recorded:row.daily[i],current:value,
    }])
    if (changed.length) sourceDrift.push({title:row.title,kind:'HISTORICAL_COUNTS_REVISED',changed})
  } catch (error) {
    sourceDrift.push({title:row.title,kind:'SOURCE_PAYLOAD_CHANGED',detail:String(error)})
  }
}

ranked.sort((a,b)=>b.lift_bps-a.lift_bps || b.recent-a.recent || (a.title < b.title ? -1 : a.title === b.title ? 0 : 1))
const seen = new Set()
const order = []
for(const row of ranked) {
  if (seen.has(row.desk)) continue
  order.push(row.index)
  seen.add(row.desk)
  if(order.length===result.slots) break
}
assert.deepEqual(order,result.order)
console.log(JSON.stringify({
  key,
  order:order.map(i=>result.rows[i].title),
  verifiedReceipts:evidence.length+1,
  failureReasons,
  verifiedRehearsalReceipts:rehearsal.transactions.length,
  legacyFailures,
  verifiedLegacyReceipts:legacyEvidence.length+1,
  sourceDrift,
  rankingSnapshot:'FINALIZED on-chain daily counts',
},null,2))
