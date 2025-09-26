const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Reutilizamos la misma "llave maestra" para hablar con Firebase.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Nos aseguramos de que Firebase solo se inicialice una vez.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Esta función es el "espía" que escucha a Stripe.
exports.handler = async (event) => {
    const sig = event.headers['stripe-signature'];
    // Esta es otra clave secreta que configuraremos en Netlify para máxima seguridad.
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let stripeEvent;

    try {
        // Stripe verifica que el mensaje que llega es auténtico y no una falsificación.
        stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
    } catch (err) {
        console.error("⚠️  Error en la verificación del webhook.", err.message);
        return {
            statusCode: 400,
            body: `Webhook Error: ${err.message}`
        };
    }
    
    const db = admin.firestore();
    // Extraemos los datos de la suscripción del evento de Stripe.
    const subscription = stripeEvent.data.object;
    const customerId = subscription.customer;
    // Buscamos en nuestra base de datos qué usuario tiene este ID de cliente de Stripe.
    const userQuery = await db.collection("userProfiles").where("stripeCustomerId", "==", customerId).get();

    if (!userQuery.empty) {
        const userId = userQuery.docs[0].id;
        const subscriptionEndDate = new Date(subscription.current_period_end * 1000);
        
        // Preparamos los datos para actualizar el perfil del usuario.
        const subscriptionData = {
            planId: subscription.items.data[0].price.id,
            // Aquí determinamos si el plan es anual o mensual basándonos en el ID del precio.
            // ¡IMPORTANTE! Asegúrate de que estos IDs coinciden con los tuyos en Stripe.
            planName: subscription.items.data[0].price.id === 'price_1S5LtFKRu7M7maFSTqnqvPh0' ? "Anual" : "Mensual",
            subscriptionStatus: subscription.status,
            subscriptionEndDate: admin.firestore.Timestamp.fromDate(subscriptionEndDate),
        };

        // Actualizamos la base de datos con el nuevo estado de la suscripción.
        await db.collection("userProfiles").doc(userId).set(subscriptionData, { merge: true });
    }
    
    // Devolvemos una respuesta a Stripe para decirle que todo ha ido bien.
    return { statusCode: 200, body: 'ok' };
};

