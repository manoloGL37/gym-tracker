---
name: Gym Tracker
description: Un cuaderno de pista digital para registrar fuerza con rapidez, disciplina y claridad.
colors:
  mineral-ivory: "#f2f0e9"
  ledger-paper: "#fbfaf6"
  paper-low: "#e8e6df"
  blackened-navy: "#111827"
  navy-soft: "#1c2738"
  graphite: "#535d69"
  quiet-slate: "#626c78"
  performance-coral: "#f15431"
  coral-deep: "#b9361f"
  coral-wash: "#fce5de"
  success-pine: "#236b52"
  danger-red: "#b73338"
  warning-ochre: "#8b5b08"
  sync-blue: "#285b9e"
  hairline: "rgb(17 24 39 / .12)"
  hairline-strong: "rgb(17 24 39 / .22)"
  focus-coral: "rgb(241 84 49 / .42)"
typography:
  display: { fontFamily: '"Bahnschrift", "DIN Alternate", "Aptos Display", "Segoe UI Variable", sans-serif', fontSize: "clamp(3rem, 14vw, 5.6rem)", fontWeight: 800, lineHeight: 0.84, letterSpacing: "-0.035em" }
  headline: { fontFamily: '"Bahnschrift", "DIN Alternate", "Aptos Display", "Segoe UI Variable", sans-serif', fontSize: "1.55rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-0.025em" }
  title: { fontFamily: '"Bahnschrift", "DIN Alternate", "Aptos Display", "Segoe UI Variable", sans-serif', fontSize: "1.15rem", fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.02em" }
  body: { fontFamily: '"Aptos", "Segoe UI Variable", system-ui, sans-serif', fontSize: "0.82rem", fontWeight: 400, lineHeight: 1.5, letterSpacing: "normal" }
  label: { fontFamily: '"Aptos", "Segoe UI Variable", system-ui, sans-serif', fontSize: "0.62rem", fontWeight: 800, lineHeight: 1, letterSpacing: "0.11em" }
  metric: { fontFamily: '"Bahnschrift", "DIN Alternate", "Aptos Display", "Segoe UI Variable", sans-serif', fontSize: "1.25rem", fontWeight: 760, lineHeight: 1, letterSpacing: "-0.02em" }
rounded: { none: "0", xs: "0.25rem", sm: "0.35rem", control: "0.65rem", card: "0.9rem", sheet: "1.25rem", circle: "50%" }
spacing: { 2xs: "0.25rem", xs: "0.35rem", sm: "0.55rem", md: "1rem", lg: "1.5rem", xl: "2.5rem", section: "4rem", dock-safe: "calc(5.35rem + env(safe-area-inset-bottom))" }
components:
  button-primary: { backgroundColor: "{colors.performance-coral}", textColor: "{colors.blackened-navy}", typography: "{typography.label}", rounded: "{rounded.none}", padding: "0 1rem", height: "3rem" }
  button-dark: { backgroundColor: "{colors.blackened-navy}", textColor: "{colors.ledger-paper}", typography: "{typography.label}", rounded: "{rounded.none}", padding: "0 1rem", height: "2.8rem" }
  field: { backgroundColor: "{colors.ledger-paper}", textColor: "{colors.blackened-navy}", typography: "{typography.body}", rounded: "{rounded.control}", padding: "0.55rem 0.65rem", height: "2.75rem" }
  numeric-field: { backgroundColor: "{colors.paper-low}", textColor: "{colors.blackened-navy}", typography: "{typography.metric}", rounded: "{rounded.sm}", padding: "0.2rem", height: "3rem" }
  chip: { backgroundColor: "{colors.paper-low}", textColor: "{colors.graphite}", typography: "{typography.label}", rounded: "{rounded.xs}", padding: "0.22rem 0.38rem" }
  mobile-dock: { backgroundColor: "{colors.ledger-paper}", textColor: "{colors.graphite}", rounded: "{rounded.card}", padding: "0.35rem", height: "4.15rem" }
---

# Design System: Gym Tracker

## Overview

**Creative North Star: "Cuaderno de pista"**

Gym Tracker es un cuaderno de entrenamiento preciso llevado al terreno digital: papel mineral, tinta casi negra, líneas de registro y una sola marca coral que señala el siguiente esfuerzo. La composición es abierta y editorial; los datos parecen anotaciones de rendimiento, no widgets de dashboard.

Es un sistema de operación móvil. Durante una sesión reduce lectura, acerca «Anterior» al campo activo y mantiene las acciones decisivas al alcance del pulgar. La sensación premium nace de disciplina, ritmo y precisión, no de ornamento.

**Key Characteristics:**
- Fondo mineral cálido y superficies separadas por tono.
- Tinta navy, tipografía numérica compacta y cifras tabulares.
- Coral reservado para acción, progreso y orientación.
- Listas abiertas y divisores finos, no mosaicos de tarjetas.
- Controles táctiles amplios, dock seguro y estados inmediatos.

## Colors

La paleta imita papel, tinta técnica y una marca coral de alto rendimiento.

### Primary
- **Performance Coral** (`performance-coral`): acción primaria, progreso e índice activo.
- **Deep Coral / Coral Wash** (`coral-deep`, `coral-wash`): acento textual contrastado y énfasis suave.

### Secondary
- **Success Pine**, **Danger Red** y **Warning Ochre**: éxito, destrucción y advertencia; nunca identidad.
- **Sync Blue**: procedencia y sincronización, subordinadas a la tarea.

### Neutral
- **Mineral Ivory**, **Ledger Paper**, **Paper Low**: lienzo, superficie y zona hundida.
- **Blackened Navy**, **Soft Navy**, **Graphite**, **Quiet Slate**: tinta, panel oscuro y jerarquía secundaria.
- **Hairlines** y **Focus Coral**: estructura de 1px y foco visible.

**The One Mark Rule.** Performance Coral es la única voz de marca; no se convierte en relleno ornamental.

## Typography

**Display Font:** Bahnschrift, con DIN Alternate y Aptos Display de respaldo.  
**Body Font:** Aptos, con Segoe UI Variable y system-ui de respaldo.  
**Label/Mono Font:** Bahnschrift para cifras, métricas e índices.

**Character:** voz atlética y mecánica para títulos y números; sans sobria para instrucciones.

### Hierarchy
- **Display:** títulos breves de página, peso 800 e interlineado muy cerrado.
- **Headline / Title:** capítulos, ejercicios, rutinas y resultados.
- **Body:** explicación funcional compacta, normalmente hasta 65ch.
- **Label:** kickers, columnas y estados; mayúsculas solo cuando orientan.
- **Metric:** tiempo, kilos, repeticiones y volumen con `tabular-nums`.

**The Numbers Carry Weight Rule.** Toda cifra de rendimiento usa la familia numérica y cifras tabulares.

## Layout

El sistema parte de 20rem y prioriza 360, 390 y 430px. El contenido general alcanza 76rem; el registro activo, 66rem. En móvil usa laterales de 1rem, ritmo vertical y reglas horizontales. La sesión fija barra de mando arriba, tabla en el centro y finalización sobre el dock. A 48rem el dock se convierte en masthead y aparecen rejillas asimétricas; bajo 23rem, las columnas se comprimen antes de ocultar datos. Los objetivos táctiles miden al menos 2.75rem (44px).

**The Open Ledger Rule.** Las colecciones son filas regladas; una tarjeta cerrada solo aparece para una superficie flotante o aislada.

**The Thumb Path Rule.** La acción que continúa o termina la sesión permanece alcanzable en móvil.

## Elevation & Depth

El sistema es plano por defecto: papel, cambios tonales y reglas crean profundidad. Las sombras se reservan al dock (`0 14px 40px rgb(12 18 28 / .16)`), barra pegajosa (`0 8px 28px rgb(17 24 39 / .16)`), acción flotante (`0 16px 38px rgb(17 24 39 / .09)`) y acceso coral (`0 8px 20px rgb(241 84 49 / .24)`).

**The Paper Stays Flat Rule.** Listas, estadísticas y formularios no reciben sombra para parecer tarjetas.

## Shapes

La geometría es ortogonal. Botones primarios, paneles, listas y gráficos son rectos; campos usan una curva moderada. Dock y hojas modales reciben radios mayores porque flotan. Círculos completos solo indican actividad o confirmación. Las reglas de 1px organizan filas y capítulos.

**The Radius Has Meaning Rule.** Cuanto más flotante es el objeto, mayor puede ser su radio; el registro permanece recto y abierto.

## Components

### Buttons
- Rectangulares, táctiles y sin degradados. El primario usa coral sobre navy; el secundario sólido invierte a navy sobre papel.
- Hover oscurece 4%; foco: contorno coral de 3px y offset de 2px; pulsación: escala 0.975.
- Destructivas discretas hasta el diálogo de confirmación.

### Chips
- Paper Low, Graphite, radio corto y etiqueta compacta; describen, no decoran.

### Cards / Containers
- Filas abiertas con reglas; fondos tonales y sombras solo según Elevation & Depth.

### Inputs / Fields
- Altura mínima de 2.75rem, papel y radio de control. Campos numéricos: 3rem, fondo hundido y centro tabular.
- Foco coral; éxito pine; error red; deshabilitado visible pero atenuado.

### Navigation
- Dock móvil de cinco destinos con Entrenar en el centro coral; masthead de escritorio con indicador coral inferior.

### Training Set Row
- Mantiene «Anterior», kg, reps y estado en una línea. Una barra coral marca la siguiente serie y pine confirma la completada.

### Session Command Bar & Sheets
- Barra navy pegajosa con rutina, tiempo y progreso; se compacta al desplazar. Las hojas suben desde móvil y se centran en escritorio. Todo movimiento respeta `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** mantener la siguiente acción y «Anterior» en la misma zona de mirada y pulgar.
- **Do** usar coral con moderación y cifras tabulares para rendimiento.
- **Do** estructurar con reglas, índices, 44px de toque y foco visible.

### Don't:
- **Don't** convertir cada bloque en una tarjeta redondeada con sombra.
- **Don't** usar degradados, vidrio, neón, cyberpunk o colores de estado como identidad.
- **Don't** ocultar datos locales utilizables detrás de estados de red.
- **Don't** dar a cancelar la jerarquía de finalizar fuera de su confirmación.
