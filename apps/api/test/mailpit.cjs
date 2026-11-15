const assert = require('node:assert/strict');

function mailpitTestEnv() {
  return {
    AUTOQA_MAIL_MODE: 'mailpit',
    AUTOQA_SMTP_HOST: process.env.AUTOQA_TEST_SMTP_HOST ?? '127.0.0.1',
    AUTOQA_SMTP_PORT: process.env.AUTOQA_TEST_SMTP_PORT ?? '1025',
    AUTOQA_MAIL_FROM: 'no-reply@autoqa.local',
  };
}

const origin = process.env.AUTOQA_TEST_MAILPIT_URL ?? 'http://127.0.0.1:8025';

async function findMessages(email) {
  const response = await fetch(origin + '/api/v1/search?query=' + encodeURIComponent('to:' + email), {
    signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200, 'Mailpit debe estar activo para esta prueba.');
  const result = await response.json();
  return result.messages.filter(message => message.To.some(to => to.Address === email));
}

async function receive(email, subject, excludedId) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const messages = await findMessages(email);
    const summary = messages.find(message => message.Subject === subject && message.ID !== excludedId);
    if (summary) {
      const response = await fetch(origin + '/api/v1/message/' + encodeURIComponent(summary.ID), {
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(response.status, 200);
      const message = await response.json();
      assert.equal(message.From.Address, 'no-reply@autoqa.local');
      const url = message.Text.match(/https?:\/\/\S+#token=[a-f0-9]{64}\b/)?.[0];
      assert.ok(url, 'El mensaje capturado debe contener un enlace de un solo uso.');
      return { id: summary.ID, url, token: new URLSearchParams(new URL(url).hash.slice(1)).get('token') };
    }
    await new Promise(resolve => setTimeout(resolve, 160));
  }
  throw new Error('Mailpit no capturó el mensaje esperado.');
}

async function clearMessages(email) {
  for (const message of await findMessages(email)) {
    const response = await fetch(origin + '/api/v1/messages', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: [message.ID] }), signal: AbortSignal.timeout(2000),
    });
    assert.ok(response.ok, 'Mailpit no pudo limpiar un mensaje de prueba.');
  }
}

module.exports = { clearMessages, mailpitTestEnv, receive };
