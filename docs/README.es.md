<p align="center">
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <strong>Español</strong> | <a href="README.ja.md">日本語</a> | <a href="README.zh-CN.md">中文</a>
</p>

# Noah for Tinkerers

**Soporte técnico que realmente resuelve problemas.** Noah es una app de escritorio que diagnostica y soluciona problemas informáticos en español. Describe lo que pasa, Noah lo investiga, te muestra el plan y lo arregla — con un solo clic.

Sin tickets. Sin esperas. Sin buscar códigos de error en Google.

<p align="center">
  <img src="images/noah-hero.png" width="800" alt="Noah diagnosticando una computadora lenta, encontrando procesos fuera de control y solucionando el problema con un clic" />
</p>
<p align="center"><i>Dices "mi computadora está lenta." Noah encuentra el problema, explica la solución y se encarga.</i></p>

## Cómo funciona

1. **Describe el problema** — con tus propias palabras, sin tecnicismos
2. **Noah investiga** — ejecuta diagnósticos en segundo plano
3. **Noah te muestra el plan** — qué encontró y qué va a hacer
4. **Haces clic en un botón** — Noah se encarga del resto y confirma la solución

Cada acción queda registrada. Las operaciones peligrosas requieren tu aprobación explícita. Noah nunca toca la configuración de arranque, firmware, software de seguridad ni archivos protegidos del sistema.

## Problemas que Noah resuelve

**"Mi internet va lento"** — Noah revisa tu red, DNS y conectividad. Encuentra el problema (servidor DNS malo, caché obsoleta, red incorrecta). Lo arregla.

**"La impresora no imprime"** — Noah revisa tus impresoras, encuentra trabajos atascados o un servicio de impresión caído, limpia la cola y reinicia el servicio.

**"Mi computadora va muy lenta"** — Noah identifica qué está consumiendo tu CPU y memoria, te muestra el proceso responsable y lo detiene. Limpia cachés si ese es el problema.

**"Una app se cierra constantemente"** — Noah revisa los registros, identifica el patrón, limpia cachés corruptas y te devuelve al trabajo.

**"Ya tuve este problema antes"** — Noah recuerda. Guarda lo que aprende sobre tu sistema — detalles del dispositivo, soluciones anteriores, tus preferencias — y se vuelve más inteligente con cada sesión.

## Comenzar

### Descargar

Ve a [Releases](https://github.com/noahapp/noah-for-tinkerers/releases) y descarga la última versión:
- **macOS** — `.dmg` (Apple Silicon)
- **Windows** — `.msi` o instalador `.exe` (x64)

> **Nota para macOS:** Noah aún no está firmado con un certificado de desarrollador de Apple. Para abrirlo: clic derecho en la app, "Abrir", y luego "Abrir" otra vez. Solo la primera vez.

### Clave API

Noah usa Claude (de Anthropic) para razonar sobre los problemas. Necesitas una clave API:

1. Obtén una en [console.anthropic.com](https://console.anthropic.com)
2. Pégala en la pantalla de configuración de Noah — listo

Tu clave se guarda localmente en tu máquina. Solo se usa para comunicarse directamente con la API de Anthropic.

## Qué puede hacer Noah

| Categoría | Mac | Windows |
|---|---|---|
| **Red** — estado, DNS, conectividad, limpiar caché, probar hosts | Sí | Sí |
| **Impresoras** — listar, cola, cancelar trabajos, reiniciar servicio | Sí | Sí |
| **Rendimiento** — CPU/memoria/disco, encontrar y detener procesos | Sí | Sí |
| **Apps** — listar, registros, limpiar cachés, mover archivos | Sí | Sí |
| **Sistema** — registros, diagnósticos, comandos shell | Sí | Sí |
| **Servicios** — listar servicios, reiniciar los atascados | — | Sí |
| **Inicio** — identificar programas que ralentizan el arranque | — | Sí |
| **Conocimiento** — recuerda tu sistema, soluciones y preferencias | Sí | Sí |

## Seguridad

- **Mira antes de actuar** — siempre ejecuta diagnósticos de solo lectura primero
- **Te muestra el plan** — ves exactamente lo que Noah hará antes de hacerlo
- **Marca acciones riesgosas** — `rm`, `sudo`, formateo de disco y similares requieren aprobación explícita con una explicación en lenguaje sencillo
- **Registra todo** — cada acción se guarda en un diario de sesión que puedes revisar y deshacer
- **Límites estrictos** — configuración de arranque, firmware, software de seguridad, particiones de disco y protección de integridad del sistema están permanentemente fuera de alcance

## Licencia

AGPL-3.0

---

*Para configuración de desarrollo, arquitectura y guías de contribución, consulta [CONTRIBUTING.md](../CONTRIBUTING.md).*
