# 🐉 DraKEN Bot Backend — Integração Kirvano

Backend serverless (Vercel) que:
1. Recebe webhooks da **Kirvano** quando alguém compra
2. **Gera key automaticamente** e envia por email
3. Gerencia licenças, renovações, reembolsos, cancelamentos
4. Serve as keys pro bot desktop consultar

---

## 📦 Estrutura

```
keybot-backend/
├── api/
│   ├── webhook-kirvano.js  # Recebe eventos da Kirvano
│   ├── keys.js             # Endpoint público (bot consulta)
│   ├── activate.js         # Bot ativa key (machine binding)
│   ├── validate.js         # Bot revalida periodicamente
│   └── admin.js            # Painel admin (protegido por senha)
├── lib/
│   ├── db.js               # Wrapper Vercel KV (Redis)
│   ├── keygen.js           # Gera keys XXXX-XXXX-XXXX-XXXX
│   └── mailer.js           # SMTP (envia email com a chave)
├── package.json
├── vercel.json
└── README.md               # Este arquivo
```

---

## 🚀 Deploy passo a passo

### 1. Instale a CLI do Vercel

```bash
npm install -g vercel
```

### 2. Faça login

```bash
vercel login
```

### 3. Deploy inicial

Dentro da pasta `keybot-backend/`:

```bash
vercel
```

Aceita todos os padrões. No fim ele te dá uma URL tipo:
`https://drakenbot-backend-abc123.vercel.app`

### 4. Conecte o Redis (Upstash)

1. Abra o projeto no painel da Vercel. Em Storage, localize o Upstash Redis que guarda as licencas existentes.
2. Conecte esse banco ao projeto. Em Settings > Environment Variables, confira se KV_REST_API_URL e KV_REST_API_TOKEN pertencem ao mesmo banco e estao disponiveis em Production.
3. Faca um novo deploy. Se o painel retornar HTTP 503, confira os Runtime Logs da funcao /api/admin.

### 5. Configure variáveis de ambiente

No dashboard do Vercel → seu projeto → **"Settings"** → **"Environment Variables"**:

| Variável | Valor exemplo | Uso |
|----------|---------------|-----|
| `SMTP_HOST` | `smtp.gmail.com` | Servidor SMTP |
| `SMTP_PORT` | `465` | Porta (465 pra SSL, 587 pra TLS) |
| `SMTP_USER` | `seuemail@gmail.com` | Login do email |
| `SMTP_PASS` | `xxxx yyyy zzzz wwww` | **Senha de app**, não a senha real |
| `SMTP_FROM` | `DraKEN Bot <seuemail@gmail.com>` | Remetente exibido |
| `DOWNLOAD_URL` | `https://drive.google.com/file/d/...` | Link do instalador |
| `SUPPORT_CONTACT` | `Ruan - @seuwhats` | Contato de suporte no email |
| `ADMIN_PASSWORD` | `senhalonga123` | Senha do painel admin |
| `KIRVANO_WEBHOOK_TOKEN` | (opcional) | Token que você configurar na Kirvano |
| `KIRVANO_PRODUCT_IDS` | (opcional) | IDs dos produtos separados por vírgula |

> **Senha de app do Gmail**: Vai em https://myaccount.google.com/apppasswords, gera uma senha de app com nome "DraKEN Bot" e usa ela em `SMTP_PASS` (não a senha real da sua conta).

### 6. Redeploy

```bash
vercel --prod
```

### 7. Configure o webhook na Kirvano

1. Acessa https://app.kirvano.com
2. **Integrações** → **Webhooks** → **Criar Webhook**
3. Preenche:
   - **Nome**: `DraKEN Bot Backend`
   - **URL do Webhook**: `https://SEU_PROJETO.vercel.app/api/webhook-kirvano`
   - **Token**: (se você configurou `KIRVANO_WEBHOOK_TOKEN`, coloca aqui)
   - **Produto**: seu produto do DraKEN Bot
   - **Eventos**: marca todos abaixo:
     - ✅ Compra aprovada (`SALE_APPROVED`)
     - ✅ Reembolso (`SALE_REFUNDED`)
     - ✅ Chargeback (`SALE_CHARGEBACK`)
     - ✅ Assinatura renovada (`SUBSCRIPTION_RENEWED`)
     - ✅ Assinatura cancelada (`SUBSCRIPTION_CANCELED`)
     - ✅ Assinatura expirada (`SUBSCRIPTION_EXPIRED`)
4. Salva

### 8. Testa!

Faça uma compra teste na Kirvano ou usa o **"Ver Logs"** do webhook pra reprocessar um evento.

---

## 🎛️ Como usar depois

### Painel Admin (você acessa)

```
https://SEU_PROJETO.vercel.app/api/admin?admin_key=SUA_SENHA&format=html
```

O painel mostra:
- Estatísticas (total, ativas, expiradas, revogadas)
- Tabela com todas as licenças
- Botões pra: Revogar / +30 dias / Reset PC
- Formulário pra criar licença manual (com email automático)

### Endpoint público (bot consulta)

```
https://SEU_PROJETO.vercel.app/api/keys
```

Retorna o mesmo formato do `keys.txt` antigo — o bot não precisa mudar.

---

## 🔧 Configuração do bot desktop

No arquivo `signal-bot/license.py` do bot, mude a linha:

```python
# Antes:
KEYS_URL = "https://keybot-3aom.vercel.app/keys.txt"

# Depois (aponta pro novo backend):
KEYS_URL = "https://SEU_PROJETO.vercel.app/api/keys"
```

Rebuild o instalador e distribui a nova versão.

---

## 🐛 Debug

### Ver logs do webhook

```bash
vercel logs SEU_PROJETO --follow
```

Ou no dashboard: **Deployments** → clica no deploy → **Runtime Logs**

### Testar o webhook manualmente

```bash
curl -X POST https://SEU_PROJETO.vercel.app/api/webhook-kirvano \
  -H "Content-Type: application/json" \
  -d '{
    "event": "SALE_APPROVED",
    "sale_id": "TEST123",
    "type": "RECURRING",
    "customer": {
      "name": "Teste",
      "email": "seuemail@gmail.com"
    },
    "plan": {
      "name": "Plano Mensal",
      "charge_frequency": "MONTHLY"
    },
    "products": [{"id":"produto-teste","name":"DraKEN Bot"}]
  }'
```

Se estiver certo, você recebe um email com uma key nova.

---

## 💡 Dicas

- **Backup dos KV**: exporta periodicamente. Use o painel admin em modo JSON:
  ```
  https://SEU_PROJETO.vercel.app/api/admin?admin_key=SUA_SENHA
  ```
  Salva o JSON.

- **Monitore emails que falham**: se `SMTP_PASS` estiver errada, o webhook cria a licença mas não envia email. Você vê nos logs e reenvia manual pelo painel.

- **Kirvano em modo teste**: use o modo sandbox pra testar sem cobrar de verdade.