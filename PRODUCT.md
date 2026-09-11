# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Personas que entrenan fuerza y usan el producto principalmente desde un teléfono durante una sesión real. Entre series necesitan consultar el rendimiento anterior, registrar peso y repeticiones con una mano y continuar sin leer ni navegar de más.

## Product Purpose

Gym Tracker permite crear rutinas, elegir ejercicios, ejecutar y registrar entrenamientos, revisar el historial y entender la progresión. Tiene que hacer que iniciar y registrar una sesión sea inmediato, y conservar los datos de forma segura tanto para invitados como para cuentas sincronizadas.

## Positioning

El entrenamiento activo es el centro del producto: el historial anterior aparece justo donde se registra la siguiente serie, y el resto de la aplicación prepara, recuerda o explica ese trabajo.

## Operating Context

- Uso principal como PWA móvil en el gimnasio, de pie, con una mano y bajo esfuerzo.
- Uso secundario fuera de la sesión para preparar rutinas, buscar ejercicios y revisar progreso.
- Anchos móviles prioritarios: 360, 390 y 430 px; adaptación intencional a tablet y escritorio.
- Los errores de red o el arranque temporal del servidor no deben ocultar datos locales utilizables ni sugerir que se han perdido.

## Capabilities and Constraints

- Mantener rutas, autenticación, sesión persistente, uso invitado, persistencia local, sincronización automática, integración backend, idempotencia, mapeos y contratos actuales.
- Mantener lógica de rutinas, ejercicios, entrenamiento activo, historial, estadísticas, peso corporal, copia/restauración y PWA.
- No inventar objetivos de series, métricas, contenido ni endpoints. La referencia histórica se denomina «Anterior».
- No exponer terminología interna de migración, enums de origen ni un selector Local/Cloud en estadísticas.
- Finalizar un entrenamiento es primario; cancelarlo es discreto, descubrible y siempre confirmado.
- El repositorio usa `master` y Vercel despliega desde esa rama.

## Brand Commitments

- Nombre: Gym Tracker.
- Voz: directa, atlética, calmada y segura; sin exclamaciones ni lenguaje de software empresarial.
- Debe sentirse premium, rápido, disciplinado y específico para entrenamiento.
- No debe sentirse como admin Angular, SaaS genérico, Material demo, dashboard financiero, Notion, interfaz clínica, videojuego o cyberpunk.
- Evitar el verde como identidad dominante y usar un solo acento con moderación.

## Evidence on Hand

- Implementación Angular existente en `src/app` como evidencia de funciones, datos, acciones y estados.
- Contrato de integración en `docs/backend/frontend-integration-contract.md`.
- Servicios, repositorios, modelos y pruebas existentes que fijan el comportamiento y la seguridad de datos.
- No hay fotografías, ilustraciones, testimonios ni métricas comerciales que deban inventarse.

## Product Principles

1. La siguiente acción de entrenamiento gana la jerarquía.
2. Los números se diseñan para leerse bajo esfuerzo y registrarse con el pulgar.
3. Preparar, ejecutar, recordar y analizar son trabajos distintos y merecen composiciones distintas.
4. La persistencia y la sincronización tranquilizan; nunca dominan la interfaz.
5. Menos contenedores, menos pasos y menos ruido son una ventaja funcional.

## Accessibility & Inclusion

Controles con objetivos táctiles de al menos 44 px, semántica nativa, foco visible, contraste legible, estados asíncronos anunciables, soporte de teclado y movimiento reducido mediante `prefers-reduced-motion`.
