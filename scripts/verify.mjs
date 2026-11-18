import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {chain, client, finalized, outcome} from '../network.js'

const deployment = JSON.parse(readFileSync('public/deployment.json'))
const evidence = JSON.parse(readFileSync('public/evidence.json'))
const key = 'field-notes-live'
assert.equal(chain.id,61999)
const deployed = await finalized(deployment.hash)
assert.equal(outcome(deployed,deployment.hash).execution,'SUCCESS')
assert.equal(deployed.to_address.toLowerCase(),deployment.address.toLowerCase())
const failureReasons = []
const reasonMismatches = []
for (const item of evidence) {
  const receipt = await finalized(item.hash)
  const actual = outcome(receipt,item.hash)
  assert.deepEqual(
    {hash:actual.hash,status:actual.status,consensus:actual.consensus,execution:actual.execution},
    {hash:item.hash,status:item.status,consensus:item.consensus,execution:item.execution},
  )
  assert.equal(receipt.from_address.toLowerCase(),item.actor)
  if (item.execution === 'ERROR') {
    failureReasons.push({method:item.method,index:item.index,hash:item.hash,reason:actual.reason})
    if (actual.reason !== item.reason) {
      reasonMismatches.push({method:item.method,hash:item.hash,recorded:item.reason,chain:actual.reason})
    }
  }
}
assert.deepEqual(reasonMismatches,[])
const result = JSON.parse(await client.readContract({
  address:deployment.address,functionName:'edition',args:[key],stateStatus:'finalized',
}))
assert.equal(result.state,'PUBLISHED')
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
  sourceDrift,
  rankingSnapshot:'FINALIZED on-chain daily counts',
},null,2))
