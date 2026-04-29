/**
 * Cloudflare Worker — SePay API Proxy for Donate Page
 * 
 * === HƯỚNG DẪN DEPLOY ===
 * 1. Truy cập https://dash.cloudflare.com → Workers & Pages → Create
 * 2. Đặt tên: "donate-api"
 * 3. Paste toàn bộ code này vào và Deploy
 * 4. Vào Settings → Variables and Secrets → Add:
 *    - Name: SEPAY_API_TOKEN
 *    - Value: (API token từ my.sepay.vn)
 *    - Chọn "Encrypt"
 * 5. Worker URL sẽ là: https://donate-api.<subdomain>.workers.dev
 * 6. Cập nhật WORKER_URL trong script.js
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

        try {
            if (!env.SEPAY_API_TOKEN) {
                return respond({ error: 'API token not configured' }, 500, corsHeaders);
            }

            const url = new URL(request.url);
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

            // Sanitize — chỉ trả về thông tin an toàn, công khai
            const donors = (data.data || []).map(tx => ({
                amount: tx.amount_in || 0,
                date: tx.transaction_date,
                content: tx.transaction_content || ''
            }));

            const totalAmount = donors.reduce((sum, d) => sum + d.amount, 0);

            const result = {
                status: 'success',
                donors,
                stats: {
                    total_amount: totalAmount,
                    total_count: data.meta?.pagination?.total || donors.length
                }
            };

            return new Response(JSON.stringify(result), {
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=120'
                }
            });
        } catch (err) {
            return respond({ error: 'Internal server error' }, 500, corsHeaders);
        }
    }
};

function respond(data, status, headers) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' }
    });
}
