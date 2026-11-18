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
const result = JSON.parse(await client.readContract({
  address:deployment.address,functionName:'edition',args:[key],stateStatus:'finalized',
}))
assert.equal(result.state,'PUBLISHED')
assert.equal(result.rows.filter(row=>row.status==='NO_SERIES').length,1)
const sorted = []
for (const [index,row] of result.rows.entries()) {
  const response = await fetch(row.source,{signal:AbortSignal.timeout(18000)})
  if (row.status === 'NO_SERIES') {
    assert.equal(response.status,404)
    continue
  }
  assert.equal(response.status,200)
  const body = await response.json()
  const daily = body.items.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).map(item=>item.views)
  assert.deepEqual(daily,row.daily)
  assert.equal(row.baseline,daily.slice(0,7).reduce((sum,value)=>sum+value,0))
  assert.equal(row.recent,daily.slice(7).reduce((sum,value)=>sum+value,0))
  assert.equal(row.lift_bps,Math.floor((row.recent-row.baseline)*10000/Math.max(row.baseline,1)))
  if(row.baseline>=100) sorted.push({index,...row})
}
sorted.sort((a,b)=>b.lift_bps-a.lift_bps || b.recent-a.recent || (a.title < b.title ? -1 : a.title === b.title ? 0 : 1))
const seen = new Set()
const order = []
for(const row of sorted) {
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
  reasonMismatches,
},null,2))
assert.deepEqual(reasonMismatches,[])
