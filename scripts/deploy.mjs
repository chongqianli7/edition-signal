import {readFileSync, writeFileSync} from 'node:fs'
import {createAccount} from 'genlayer-js'
import {client, finalized, outcome} from '../network.js'

const hash = await client.deployContract({
  account:createAccount(),
  code:readFileSync(new URL('../contracts/edition_signal.py', import.meta.url), 'utf8'),
  args:[],
})
console.log(hash)
const receipt = await finalized(hash)
const deployment = {...outcome(receipt, hash), address:receipt.to_address}
console.log(deployment)
if (deployment.status !== 'FINALIZED' || deployment.execution !== 'SUCCESS') process.exit(1)
writeFileSync('public/deployment.json', JSON.stringify(deployment, null, 2) + '\n')
