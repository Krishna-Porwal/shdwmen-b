import { query } from '../src/db/connection';

async function processRefunds() {
  try {
    // Move initiated -> processing
    const initiated = await query(`SELECT id, order_id, refund_id FROM refunds WHERE refund_status = 'initiated' LIMIT 50`);
    for (const r of initiated.rows) {
      await query(`UPDATE refunds SET refund_status = 'processing' WHERE id = $1`, [r.id]);
      console.log('Marked refund processing for', r.refund_id || r.order_id);
    }

    // Simulate processing completed for older processing entries
    const processing = await query(`SELECT id, order_id, refund_id FROM refunds WHERE refund_status = 'processing' LIMIT 50`);
    for (const r of processing.rows) {
      await query(`UPDATE refunds SET refund_status = 'completed', refund_completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [r.id]);
      await query(`UPDATE orders SET refund_status = 'completed', refund_completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [r.order_id]);
      console.log('Completed refund for', r.refund_id || r.order_id);
    }

    console.log('Refund processing run completed');
  } catch (err) {
    console.error('Refund processor error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  processRefunds().then(() => process.exit(0));
}

export default processRefunds;
