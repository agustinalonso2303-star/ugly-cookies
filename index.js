const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();

/**
 * Esta función se dispara automáticamente cuando se crea un nuevo documento
 * en la colección 'orders'. Es totalmente invisible para el usuario final.
 * ENVÍA EL PEDIDO POR WHATSAPP A LA SUCURSAL CORRESPONDIENTE
 */
exports.sendOrderToWhatsApp = functions.firestore
    .document('orders/{orderId}')
    .onCreate(async (snapshot, context) => {
        const order = snapshot.data();
        const orderId = context.params.orderId;

        try {
            // 1. Obtener configuración de WhatsApp desde Firestore
            const configDoc = await admin.firestore().collection('admin_config').doc('whatsapp_config').get();
            
            if (!configDoc.exists) {
                console.error('No se encontró la configuración de WhatsApp');
                return snapshot.ref.update({ whatsappStatus: 'no_config', error: 'No hay configuración de WhatsApp' });
            }

            const whatsappConfig = configDoc.data();
            
            // 2. Obtener información de la sucursal para obtener su número
            const branchDoc = await admin.firestore().collection('branches').doc(order.branch).get();
            
            if (!branchDoc.exists) {
                console.error('No se encontró la sucursal:', order.branch);
                return snapshot.ref.update({ whatsappStatus: 'branch_not_found', error: 'Sucursal no encontrada' });
            }

            const branch = branchDoc.data();
            const branchPhoneNumber = branch.whatsappNumber;

            if (!branchPhoneNumber) {
                console.error('La sucursal no tiene número de WhatsApp configurado:', order.branchId);
                return snapshot.ref.update({ whatsappStatus: 'no_phone', error: 'Sucursal sin número WhatsApp' });
            }

            // 3. Formatear el mensaje de WhatsApp
            const message = formatWhatsAppMessage(order, branch, orderId);

            // 4. Enviar mensaje por WhatsApp Business API
            const whatsappResponse = await sendWhatsAppMessage(
                whatsappConfig.apiKey,
                whatsappConfig.phoneNumberId,
                branchPhoneNumber,
                message
            );

            // 5. Marcar como enviado con éxito
            return snapshot.ref.update({
                whatsappStatus: 'sent',
                whatsappSentAt: admin.firestore.FieldValue.serverTimestamp(),
                whatsappMessageId: whatsappResponse.id
            });

        } catch (error) {
            console.error('Error enviando pedido por WhatsApp:', error);
            return snapshot.ref.update({
                whatsappStatus: 'failed',
                whatsappError: error.message
            });
        }
    });

/**
 * Formatea el mensaje de WhatsApp de forma bonita y legible
 */
function formatWhatsAppMessage(order, branch, orderId) {
    const itemsList = order.items.map(item => 
        `• ${item.quantity}x ${item.name} - $${item.price * item.quantity}`
    ).join('\n');

    const message = `🍪 *NUEVO PEDIDO WEB - UGLY COOKIES*
📍 *Sucursal:* ${branch.name.toUpperCase()}
👤 *Cliente:* ${order.userName || 'No especificado'}
📞 *Tel:* ${order.userPhone || 'No especificado'}
📧 *Email:* ${order.userEmail || 'No especificado'}

📦 *PEDIDO:*
${itemsList}

💰 *TOTAL: $${order.total}*
💳 *Método:* ${order.paymentMethod || 'No especificado'}

⏰ *Hora:* ${new Date().toLocaleTimeString('es-AR')}
🔔 *Pedido web:* #${orderId}

_Confirmar recepción del pedido_`;

    return message;
}

/**
 * Envía mensaje usando WhatsApp Business API (Meta)
 */
async function sendWhatsAppMessage(apiKey, phoneNumberId, toNumber, message) {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    
    const response = await axios.post(url, {
        messaging_product: "whatsapp",
        to: toNumber,
        type: "text",
        text: {
            body: message
        }
    }, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}