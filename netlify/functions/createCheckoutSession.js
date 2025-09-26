const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Esta es la "llave maestra" que le da permiso a Netlify para hablar con tu base de datos.
// La configuraremos como una variable secreta en Netlify.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Nos aseguramos de que Firebase solo se inicialice una vez.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Esta es la función principal que se ejecuta cuando la app la llama.
exports.handler = async (event) => {
  // Solo permitimos que esta función se ejecute si la app envía datos (método POST).
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  // Extraemos los datos que nos envía la app: qué plan ha elegido, el ID del usuario, etc.
  const { priceId, successUrl, cancelUrl, userId, userEmail } = JSON.parse(event.body);

  // Verificamos que el usuario está identificado. ¡Seguridad ante todo!
  if (!userId) {
     return { statusCode: 401, body: JSON.stringify({ error: "Debes estar autenticado." }) };
  }

  const db = admin.firestore();
  let customerId;
  const userRef = db.collection("userProfiles").doc(userId);
  const userDoc = await userRef.get();
  
  // Comprobamos si ya hemos creado un cliente en Stripe para este usuario.
  if (userDoc.exists && userDoc.data().stripeCustomerId) {
    customerId = userDoc.data().stripeCustomerId;
  } else {
    // Si no existe, creamos un nuevo cliente en Stripe.
    const customer = await stripe.customers.create({
      email: userEmail,
      metadata: { firebaseUID: userId },
    });
    customerId = customer.id;
    // Y guardamos su ID en nuestra base de datos para no tener que crearlo de nuevo.
    await userRef.set({ stripeCustomerId: customerId }, { merge: true });
  }

  try {
    // Creamos la sesión de pago en Stripe con todos los datos.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    });

    // Devolvemos el ID de la sesión a la app para que pueda redirigir al usuario.
    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };
  } catch (error) {
    console.error("Error al crear la sesión de Stripe:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "No se pudo crear la sesión de pago." }),
    };
  }
};

