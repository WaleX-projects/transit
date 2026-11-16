// Edge Function: dispatch-sms
// Runs on a Database Webhook for INSERT on sms_outbox

import { createClient } from 'jsr:@supabase/supabase-js@2';

export interface SmsSendOptions {
  to: string;
  body: string;
}

export interface SmsSendResult {
  messageId: string;
  success: boolean;
}

export interface SmsProvider {
  send(options: SmsSendOptions): Promise<SmsSendResult>;
}

export class ConsoleProvider implements SmsProvider {
  async send(options: SmsSendOptions): Promise<SmsSendResult> {
    console.log(`[ConsoleProvider] Dispatching SMS to ${options.to}: ${options.body}`);
    return {
      messageId: `msg_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      success: true,
    };
  }
}

function getProvider(name?: string): SmsProvider {
  const providerName = (name || Deno.env.get('SMS_PROVIDER') || 'console').toLowerCase();
  if (providerName === 'console') {
    return new ConsoleProvider();
  }
  return new ConsoleProvider();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = await req.json();
    const record = payload.record;

    if (!record || !record.id) {
      return new Response(JSON.stringify({ error: 'Invalid webhook record' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (record.status !== 'queued') {
      return new Response(JSON.stringify({ message: 'Record is not queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const provider = getProvider();
    const result = await provider.send({
      to: record.to_phone,
      body: record.body,
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Replace the 6-digit pickup code in body with "******"
    const maskedBody = record.body.replace(/(Pickup code:\s*)(\d{6})/i, '$1******');

    if (result.success) {
      await supabase
        .from('sms_outbox')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: result.messageId,
          body: maskedBody,
        })
        .eq('id', record.id);
    } else {
      await supabase
        .from('sms_outbox')
        .update({
          status: 'failed',
          error: 'Provider dispatch failed',
        })
        .eq('id', record.id);
    }

    return new Response(JSON.stringify({ success: true, messageId: result.messageId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
