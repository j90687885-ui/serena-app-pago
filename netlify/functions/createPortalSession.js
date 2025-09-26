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

// Esta es la función principal que se ejecuta cuando el usuario quiere gestionar su cuenta.
exports.handler = async (event) => {
    // Solo permitimos que esta función se ejecute si la app envía datos.
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Método no permitido' };
    }
    
    // Extraemos los datos que nos envía la app.
    const { returnUrl, userId } = JSON.parse(event.body);

    // Verificamos que el usuario está identificado.
    if (!userId) {
        return { statusCode: 401, body: JSON.stringify({ error: "Debes estar autenticado." }) };
    }

    const db = admin.firestore();
    const userRef = db.collection("userProfiles").doc(userId);
    const userDoc = await userRef.get();
    const customerId = userDoc.data().stripeCustomerId;

    // Si por alguna razón no encontramos un cliente de Stripe, devolvemos un error.
    if (!customerId) {
        return { statusCode: 404, body: JSON.stringify({ error: "No se encontró un cliente de Stripe para este usuario." }) };
    }

    try {
        // Le pedimos a Stripe que cree un portal de facturación para este cliente.
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });
        // Devolvemos la URL segura del portal a la app.
        return {
            statusCode: 200,
            body: JSON.stringify({ url: portalSession.url }),
        };
    } catch (error) {
        console.error("Error al crear el portal de cliente:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "No se pudo abrir el portal de gestión." }) };
    }
};

