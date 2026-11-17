# Colección HLP

Aplicación de trabajo y consulta estática para GitHub Pages, migrada desde `hlp(1).zip`. Conserva la interfaz, el inventario y el estado 832: 154 cajas, 27 agrupaciones, 685 ítems Aleph, 294 registros analíticos y un registro de catalogación. El catálogo agrupa ejemplares por registro bibliográfico: su contador no equivale al número de ítems Aleph.

## Publicar por primera vez

En **Settings → Pages → Build and deployment → Source**, seleccionar **GitHub Actions**. El flujo `Publicar Colección HLP` valida los datos y publica el sitio después de cada cambio en `main`. También puede iniciarse en **Actions → Publicar Colección HLP → Run workflow**.

Dirección prevista: `https://frankhode.github.io/coleccionhlp/`, disponible cuando termina el despliegue. Consulta: `index.html`. Administración: `index.html?admin=1`.

## Trabajo cotidiano

1. Abrir **Administración** e ingresar un token de acceso detallado para este repositorio, con **Contents: Read and write**. La cuenta debe tener permiso de escritura. No hacen falta permisos de administración ni de workflows para publicar datos desde la aplicación.
2. Los cambios y miniaturas se guardan en un **borrador de este navegador** mediante IndexedDB. Al volver a ingresar se ofrece recuperarlo. La barra superior distingue el borrador de la publicación; el aviso de guardado de la interfaz heredada también corresponde al borrador.
3. Pulsar **Publicar cambios** y revisar el resumen. Se crea un único commit con los datos y miniaturas. GitHub Pages actualiza la consulta después de su despliegue.
4. Desde **Borrador y respaldo**, exportar antes de cambiar de computadora, limpiar el navegador o resolver un conflicto. Se exportan datos y miniaturas nuevas; las imágenes ya publicadas permanecen en GitHub. Ese archivo puede importarse en otra sesión administrativa.

El token permanece únicamente en memoria durante la sesión y se retira del campo tras el ingreso. No se guarda en URLs, archivos, borradores ni almacenamiento del navegador. Al recargar o salir hay que ingresarlo de nuevo. No compartirlo por chat ni incorporarlo al repositorio.

La separación pública/administrativa controla la edición; **el contenido publicado del repositorio es público**, incluidos los JSON y sus datos de trabajo. Los permisos de GitHub controlan la modificación. Esta arquitectura no permite conservar datos confidenciales publicados dentro del repositorio.

## Imágenes y carpeta de altas

- Al cargar una imagen, el navegador crea un WebP con lado mayor de hasta **640 px** y calidad **0,70**, sin ampliar archivos pequeños. Se admiten JPG, PNG y WebP de hasta 25 MB. La interfaz procesa lotes de diez.
- Ejemplo: `images/001672311/retrato_001.webp`. Se conserva el nombre base y se limpian caracteres incompatibles. Las repeticiones del mismo registro reciben `-2`, `-3`, etc.; `originalName` conserva el nombre recibido.
- **Conectar carpeta de altas** permite seleccionar `C:\Users\francisco.ortiz\Desktop\bajas\Coleccion HLP`. El navegador exige esa selección: una página no puede abrir por su cuenta una ruta de Windows.
- Chrome/Edge ofrecen permiso de solo lectura y pueden recordar la carpeta. Si el permiso caduca hay que seleccionarla otra vez. Otros navegadores ofrecen selección de una carpeta de archivos.
- Conectar la carpeta no carga ni asigna automáticamente todas sus imágenes. Primero se cargan las miniaturas en cada registro; al ampliar se busca el JPG original por nombre, incluidas las subcarpetas. Si hay nombres repetidos, se exige una ruta relativa coincidente; los casos ambiguos muestran la miniatura.
- Solo se lee el original que se abre en el visor. Los JPG permanecen en la computadora. En otra computadora se ve la miniatura, salvo que también se conecte una copia de las altas.
- Se conservan frente/reverso, estereoscopía, reasignación y asociaciones analíticas. Quitar una imagen retira su asociación del catálogo; los archivos ya publicados permanecen en GitHub y su historial. No es una herramienta de borrado definitivo.

## Recuperación y conflictos

Cada borrador conserva el commit de partida. Si cambia `main`, se detiene la publicación y se conserva el borrador. La actualización del ref nunca se fuerza. Exportar antes de recargar: no se fusionan automáticamente árboles completos.

Las revisiones de IndexedDB evitan que dos pestañas sobrescriban el mismo borrador. Se usa además Web Locks durante publicaciones cuando está disponible. No limpiar el almacenamiento mientras haya cambios sin publicar.

El panel interno conserva hasta cinco respaldos locales y doce cambios de árbol para deshacer. No se importó el historial antiguo de XAMPP. Su respaldo JSON contiene solo el árbol. GitHub conserva el historial de publicaciones; limpiar el navegador elimina los borradores y respaldos locales.

## Código y comprobación

No se necesitan PHP, XAMPP, base de datos ni dependencias de npm.

```bash
npm test
npm run check
python3 tools/package_site.py
```

El paquete `dist/` contiene solo lo que se publica. Para pruebas locales, servirlo mediante un servidor estático; `file://` no permite leer los JSON con fetch.

| Archivo | Responsabilidad |
| --- | --- |
| `assets/boot.js` | Acceso, borradores, carpeta local y publicación |
| `assets/store.js` | IndexedDB, revisiones y guardado del árbol |
| `assets/api.js` | Adaptación de las operaciones existentes |
| `assets/github.js` | API de GitHub y publicación atómica |
| `assets/images.js` | WebP, nombres y archivos locales |
| `assets/legacy.js`, `assets/legacy.css` | Interfaz compilada recuperada |
| `data/tree.json` | Estado publicado |
| `data/digitals.json` | Metadatos de imágenes |
| `data/migration.json` | Recuento de la migración inicial |

El ZIP incluía la interfaz compilada sin las fuentes React. Se conserva con sus avisos de licencia y un punto de montaje adaptado; la nueva capa usa módulos legibles. No subir `storage/state.json`: contiene 51 MB de estado e historial local.

Se retiraron 634 metadatos de imágenes antiguas, quince vínculos analíticos y los campos de imagen del registro de catalogación para empezar la nueva carga. Se conservaron los datos descriptivos, asignaciones y organización. Los JPG no estaban incluidos en el ZIP.

Referencias: [Pages con Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [referencias Git](https://docs.github.com/en/rest/git/refs) y [lectura de archivos](https://docs.github.com/en/rest/repos/contents).
