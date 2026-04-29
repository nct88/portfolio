/**
 * Cloudflare Worker — SePay Custom Checkout (Không cần KV)
 * 
 * === HƯỚNG DẪN DEPLOY ===
 * 1. Truy cập https://dash.cloudflare.com → Workers & Pages → Create
 * 2. Đặt tên: "donate-api"
 * 3. Paste toàn bộ code này vào và Deploy
 * 4. Vào Settings → Variables and Secrets → Add:
 *    - SEPAY_API_TOKEN: (API token từ my.sepay.vn) → Encrypt
 * 5. Worker URL: https://donate-api.<subdomain>.workers.dev
 * 
 * KHÔNG cần KV Namespace. Worker dùng SePay API để kiểm tra giao dịch.
 */

export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method !== 'GET') {
            return respond({ error: 'Method not allowed' }, 405, corsHeaders);
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            if (!env.SEPAY_API_TOKEN) {
                return respond({ error: 'API token not configured' }, 500, corsHeaders);
            }

            // ============================================================
            // GET /check?code=XXX — Kiểm tra giao dịch theo mã CK
            // ============================================================
            if (path === '/check') {
                return await handleCheckPayment(url, env, corsHeaders);
            }

            // ============================================================
            // GET / — Lấy danh sách donors
            // ============================================================
            return await handleGetDonors(url, env, corsHeaders);

        } catch (err) {
            console.error('Worker error:', err);
            return respond({ error: 'Internal server error' }, 500, corsHeaders);
        }
    }
};

// ============================================================
// Check Payment — Tìm giao dịch khớp mã chuyển khoản
// ============================================================
async function handleCheckPayment(url, env, corsHeaders) {
    const code = (url.searchParams.get('code') || '').trim();
    const amount = parseInt(url.searchParams.get('amount') || '0');

    if (!code) {
        return respond({ error: 'Missing code' }, 400, corsHeaders);
    }

    // Gọi SePay API lấy giao dịch gần đây
    const apiUrl = `https://userapi.sepay.vn/v2/transactions?transfer_type=in&transaction_date_sort=desc&per_page=20`;

    const apiRes = await fetch(apiUrl, {
        headers: {
            'Authorization': `Bearer ${env.SEPAY_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });

    if (!apiRes.ok) {
        return respond({ status: 'error', message: 'API error' }, 200, corsHeaders);
    }

    const data = await apiRes.json();

    if (data.status !== 'success' || !data.data) {
        return respond({ status: 'pending' }, 200, corsHeaders);
    }

    // Tìm giao dịch khớp mã chuyển khoản
    const codeUpper = code.toUpperCase();
    const matched = data.data.find(tx => {
        const content = (tx.transaction_content || '').toUpperCase();
        const txAmount = tx.amount_in || 0;
        // Khớp nội dung CK chứa mã code
        const contentMatch = content.includes(codeUpper);
        // Khớp số tiền (nếu có)
        const amountMatch = amount ? txAmount >= amount : true;
        return contentMatch && amountMatch;
    });

    if (matched) {
        return new Response(JSON.stringify({
            status: 'paid',
            transaction: {
                amount: matched.amount_in,
                date: matched.transaction_date,
                gateway: matched.bank_brand_name || 'Bank'
            }
        }), {
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
    }

    return new Response(JSON.stringify({ status: 'pending' }), {
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
        }
    });
}

// ============================================================
// Get Donors — Lấy danh sách người ủng hộ
// ============================================================
async function handleGetDonors(url, env, corsHeaders) {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 100);
    const apiUrl = `https://userapi.sepay.vn/v2/transactions?transfer_type=in&transaction_date_sort=desc&per_page=${limit}`;

    const apiRes = await fetch(apiUrl, {
        headers: {
            'Authorization': `Bearer ${env.SEPAY_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });

    if (!apiRes.ok) {
        return respond({ error: 'SePay API error' }, apiRes.status, corsHeaders);
    }

    const data = await apiRes.json();

    if (data.status !== 'success') {
        return respond({ error: 'API returned error' }, 500, corsHeaders);
    }

    const donors = (data.data || []).map(tx => ({
        amount: tx.amount_in || 0,
        date: tx.transaction_date,
        content: tx.transaction_content || ''
    }));

    const totalAmount = donors.reduce((sum, d) => sum + d.amount, 0);

    return new Response(JSON.stringify({
        status: 'success',
        donors,
        stats: {
            total_amount: totalAmount,
            total_count: data.meta?.pagination?.total || donors.length
        }
    }), {
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=120'
        }
    });
}

// ============================================================
// Helpers
// ============================================================
function respond(data, status, headers) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' }
    });
}
