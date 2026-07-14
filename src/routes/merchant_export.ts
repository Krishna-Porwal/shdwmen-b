import express from 'express';
import { query } from '../db/connection';
import { requireMerchant } from '../middleware/auth';
import logger from '../logger';

const router = express.Router();

function csvEscape(v: any) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

router.get('/analytics/export/total-orders', requireMerchant, async (req, res) => {
  try {
    const merchantId = req.auth?.userId;
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const search = req.query.search ? String(req.query.search).toLowerCase().trim() : '';

    const params: any[] = [merchantId];
    let whereClauses = `WHERE EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.merchant_id = $1)`;
    let idx = 2;
    if (from) { whereClauses += ` AND o.created_at >= $${idx}`; params.push(from.toISOString()); idx++; }
    if (to) { whereClauses += ` AND o.created_at <= $${idx}`; params.push(to.toISOString()); idx++; }

    const rowsRes = await query(`SELECT DISTINCT o.id, o.total_amount, o.status, o.payment_method, o.created_at, o.user_id FROM orders o ${whereClauses} ORDER BY created_at DESC`, params);
    let rows = rowsRes.rows;
    if (search) rows = rows.filter((r:any)=>JSON.stringify(r).toLowerCase().includes(search));

    const csvRows = [['id','total_amount','status','payment_method','created_at','user_id'], ...rows.map((r:any)=>[r.id,r.total_amount,r.status,r.payment_method,r.created_at,r.user_id])];
    const csv = csvRows.map((r:any[])=>r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="total_orders_export.csv"');
    res.send(csv);
  } catch (err) {
    logger.error('Export total-orders failed', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/analytics/export/revenue', requireMerchant, async (req, res) => {
  try {
    const merchantId = req.auth?.userId;
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const params: any[] = [merchantId];
    let whereClauses = `WHERE EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.merchant_id = $1)`;
    let idx = 2;
    if (from) { whereClauses += ` AND o.created_at >= $${idx}`; params.push(from.toISOString()); idx++; }
    if (to) { whereClauses += ` AND o.created_at <= $${idx}`; params.push(to.toISOString()); idx++; }

    const timeseries = await query(`SELECT DATE(o.created_at) as day, COALESCE(SUM(o.total_amount),0) as revenue FROM orders o ${whereClauses} GROUP BY DATE(o.created_at) ORDER BY day ASC`, params);
    const csvRows = [['day','revenue'], ...timeseries.rows.map((r:any)=>[r.day, r.revenue])];
    const csv = csvRows.map((r:any[])=>r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="revenue_export.csv"');
    res.send(csv);
  } catch (err) {
    logger.error('Export revenue failed', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/analytics/export/cod', requireMerchant, async (req, res) => {
  try {
    const merchantId = req.auth?.userId;
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const params: any[] = [merchantId];
    let whereClauses = `AND EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.merchant_id = $1)`;
    let idx = 2;
    let filters = '';
    if (from) { filters += ` AND o.created_at >= $${idx}`; params.push(from.toISOString()); idx++; }
    if (to) { filters += ` AND o.created_at <= $${idx}`; params.push(to.toISOString()); idx++; }

    const rows = await query(`SELECT DISTINCT o.id, o.total_amount, o.status, o.created_at FROM orders o WHERE o.payment_method='cod' ${filters} ${whereClauses} ORDER BY created_at DESC`, params);
    const csvRows = [['id','total_amount','status','created_at'], ...rows.rows.map((r:any)=>[r.id,r.total_amount,r.status,r.created_at])];
    const csv = csvRows.map((r:any[])=>r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="cod_export.csv"');
    res.send(csv);
  } catch (err) {
    logger.error('Export cod failed', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/analytics/export/cancelled-orders', requireMerchant, async (req, res) => {
  try {
    const merchantId = req.auth?.userId;
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const params: any[] = [merchantId];
    let filters = '';
    let idx = 2;
    if (from) { filters += ` AND o.cancelled_at >= $${idx}`; params.push(from.toISOString()); idx++; }
    if (to) { filters += ` AND o.cancelled_at <= $${idx}`; params.push(to.toISOString()); idx++; }

    const rows = await query(`SELECT DISTINCT o.id, o.total_amount, o.cancel_reason, o.cancel_reason_type, o.cancelled_by, o.cancelled_at, o.created_at FROM orders o WHERE o.status='cancelled' ${filters} AND EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.merchant_id = $1) ORDER BY cancelled_at DESC NULLS LAST`, params);
    const csvRows = [['id','total_amount','cancel_reason','cancel_reason_type','cancelled_by','cancelled_at','created_at'], ...rows.rows.map((r:any)=>[r.id,r.total_amount,r.cancel_reason,r.cancel_reason_type,r.cancelled_by,r.cancelled_at,r.created_at])];
    const csv = csvRows.map((r:any[])=>r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="cancelled_orders_export.csv"');
    res.send(csv);
  } catch (err) {
    logger.error('Export cancelled-orders failed', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
