import {createClient} from 'genlayer-js'
import {studionet} from 'genlayer-js/chains'
import {TransactionStatus, transactionsStatusNumberToName} from 'genlayer-js/types'

export const chain = studionet
export const client = createClient({chain})
export const explorer = 'https://explorer-studio.genlayer.com'
export async function finalized(hash) {
  const deadline = Date.now() + 300000
  while (Date.now() < deadline) {
    let receipt
    try {
      receipt = await client.getTransaction({hash})
    } catch {
      // A transient RPC or indexing failure does not invalidate the submitted hash.
    }
    if (receipt && outcome(receipt, hash).status === TransactionStatus.FINALIZED) return receipt
    await new Promise(resolve => setTimeout(resolve, 4500))
  }
  throw new Error('Finalization timed out for ' + hash)
}
export function outcome(receipt, hash) {
  const vote = receipt.consensus_data?.leader_receipt?.[0]
  const rawExecution = receipt.txExecutionResultName ?? vote?.execution_result
  const execution = rawExecution === 'FINISHED_WITH_RETURN' ? 'SUCCESS'
    : rawExecution === 'FINISHED_WITH_ERROR' ? 'ERROR'
    : rawExecution
  const reasonCandidates = [
    vote?.genvm_result?.stderr,
    vote?.genvm_result?.error,
    vote?.genvm_result?.message,
    vote?.result?.stderr,
    vote?.result?.payload?.readable,
    vote?.result?.readable,
    vote?.error,
    ...Object.values(vote?.eq_outputs ?? {}).map(output => output?.payload?.readable ?? output?.readable),
  ]
  const reason = execution === 'ERROR'
    ? reasonCandidates.find(value => typeof value === 'string' && value.trim())?.trim() ?? null
    : null
  return {
    hash,
    status: receipt.statusName ?? transactionsStatusNumberToName[receipt.status] ?? receipt.status,
    consensus: receipt.result_name ?? receipt.resultName,
    execution,
    reason,
  }
}
