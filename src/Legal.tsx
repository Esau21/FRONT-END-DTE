/*
 * Textos legales públicos: Política de Privacidad (/privacidad) y
 * Condiciones del Servicio (/terminos). Se leen sin iniciar sesión, porque
 * Google exige que ambas páginas sean accesibles para todos.
 */

const APP_NAME = 'Bookeep'
const APP_URL = 'https://dte-front-925658751247.us-east4.run.app'
/** Correo de contacto para temas de privacidad y soporte. */
const CONTACT_EMAIL = 'tariqventura@gmail.com'
const UPDATED = '27 de noviembre de 2026'

function Contact() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
}

function AppLink() {
  return <a href={APP_URL}>{APP_URL.replace('https://', '')}</a>
}

export function PrivacyPolicy() {
  return (
    <>
      <h1>Política de Privacidad</h1>
      <p className="legal-date">Última actualización: {UPDATED}</p>

      <p>
        En {APP_NAME} valoramos tu privacidad y nos comprometemos a proteger tus datos
        personales y tributarios. Esta Política de Privacidad describe cómo recopilamos,
        usamos y protegemos la información cuando utilizas nuestra aplicación web (
        <AppLink />
        ).
      </p>

      <h2>1. Información que recopilamos</h2>
      <ul>
        <li>
          <strong>Datos de autenticación:</strong> al iniciar sesión con Google o Microsoft
          recibimos tu nombre, dirección de correo electrónico y foto de perfil, únicamente
          para identificar tu cuenta y gestionar el acceso.
        </li>
        <li>
          <strong>Correos y adjuntos:</strong> con tu autorización, accedemos en modo de solo
          lectura a tu buzón para localizar facturas y comprobantes electrónicos. Leemos el
          remitente, el asunto, la fecha y los archivos adjuntos (PDF y JSON) de esos
          mensajes. Nunca enviamos, modificamos ni eliminamos tus correos.
        </li>
        <li>
          <strong>Datos tributarios:</strong> la información contenida en los Documentos
          Tributarios Electrónicos (DTE) que recibes, como NIT, NRC, razón social, dirección
          fiscal, códigos de generación y detalle de las transacciones.
        </li>
        <li>
          <strong>Archivos guardados:</strong> las copias de adjuntos que decides guardar en
          la nube desde la aplicación, junto con las carpetas que creas para ordenarlas.
        </li>
      </ul>

      <h2>2. Uso de la información</h2>
      <p>Utilizamos la información recopilada exclusivamente para:</p>
      <ul>
        <li>
          Mostrarte tus facturas y comprobantes, calcular totales y resúmenes y permitirte
          exportarlos.
        </li>
        <li>Guardar y organizar las copias de archivos que tú eliges conservar.</li>
        <li>Proveer, operar, mantener y proteger el servicio.</li>
        <li>Comunicarnos contigo sobre la seguridad de tu cuenta o cambios en el servicio.</li>
      </ul>

      <h2>3. Uso de datos de las API de Google</h2>
      <p>
        El uso y la transferencia a cualquier otra aplicación de la información recibida de
        las API de Google por parte de {APP_NAME} se ajustan a la{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Política de Datos de Usuario de los Servicios de API de Google
        </a>
        , incluidos los requisitos de uso limitado. En particular:
      </p>
      <ul>
        <li>Solo usamos los datos de Gmail para ofrecerte las funciones descritas arriba.</li>
        <li>No usamos tus datos para publicidad ni los vendemos.</li>
        <li>
          Ninguna persona lee tus correos, salvo que nos des tu consentimiento expreso para
          atender una solicitud de soporte, cuando sea necesario por motivos de seguridad o
          cuando lo exija la ley.
        </li>
        <li>No usamos tus datos para entrenar modelos de inteligencia artificial.</li>
      </ul>

      <h2>4. Protección y almacenamiento de datos</h2>
      <p>
        Implementamos medidas de seguridad técnicas y administrativas, como el cifrado en
        tránsito y en reposo, para proteger tu información contra accesos no autorizados.
        Los datos se alojan en la infraestructura de Google Cloud. No vendemos, alquilamos ni
        compartimos tus datos personales o comerciales con terceros con fines publicitarios;
        solo los tratan los proveedores de infraestructura necesarios para operar el
        servicio.
      </p>

      <h2>5. Derechos del usuario</h2>
      <p>
        Puedes solicitar el acceso, la rectificación o la eliminación de tus datos en
        cualquier momento escribiendo a <Contact />. También puedes retirar el acceso de{' '}
        {APP_NAME} a tu cuenta desde la{' '}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
          configuración de permisos de tu cuenta de Google
        </a>
        . Los registros fiscales que guardes pueden estar sujetos a los plazos de
        conservación exigidos por la legislación tributaria vigente.
      </p>

      <h2>6. Cambios a esta política</h2>
      <p>
        Podemos actualizar esta política cuando cambie el servicio o la normativa aplicable.
        Publicaremos la versión vigente en esta página con su fecha de actualización.
      </p>

      <h2>7. Contacto</h2>
      <p>
        Si tienes preguntas sobre esta política, escríbenos a <Contact />.
      </p>
    </>
  )
}

export function TermsOfService() {
  return (
    <>
      <h1>Condiciones del Servicio</h1>
      <p className="legal-date">Última actualización: {UPDATED}</p>

      <p>
        Al acceder y utilizar {APP_NAME} (<AppLink />
        ), aceptas cumplir con las siguientes Condiciones del Servicio.
      </p>

      <h2>1. Descripción del servicio</h2>
      <p>
        {APP_NAME} ofrece herramientas para consultar, organizar, resumir, exportar y
        guardar los Documentos Tributarios Electrónicos (DTE) y comprobantes que recibes en
        tu correo electrónico.
      </p>

      <h2>2. Responsabilidades del usuario</h2>
      <ul>
        <li>
          Eres responsable de mantener la confidencialidad de tus credenciales de acceso y de
          la cuenta de correo que conectas.
        </li>
        <li>
          Garantizas que tienes autorización para acceder a la cuenta de correo y a los
          documentos que consultas o guardas en la plataforma.
        </li>
        <li>
          Te comprometes a no utilizar el servicio para actividades ilícitas, fraudulentas o
          que comprometan la seguridad de la infraestructura.
        </li>
      </ul>

      <h2>3. Información tributaria</h2>
      <p>
        La plataforma muestra la información tal como viene en los documentos recibidos. No
        constituye asesoría contable ni tributaria; te recomendamos verificar los documentos
        en el portal del Ministerio de Hacienda antes de usarlos en tus declaraciones.
      </p>

      <h2>4. Disponibilidad y limitación de responsabilidad</h2>
      <p>
        Nos esforzamos por mantener la plataforma disponible de forma continua; sin embargo,
        no nos hacemos responsables por interrupciones derivadas de fallos en servicios de
        terceros, proveedores de internet o plataformas externas, como los servicios de
        correo o de la administración tributaria.
      </p>

      <h2>5. Modificaciones</h2>
      <p>
        Nos reservamos el derecho de actualizar estas condiciones en cualquier momento. El
        uso continuado de la plataforma tras dichos cambios constituye la aceptación de los
        nuevos términos.
      </p>

      <h2>6. Contacto</h2>
      <p>
        Para consultas sobre estas condiciones, contáctanos en <Contact />.
      </p>
    </>
  )
}
