(function () {
    'use strict';

    function whenReady(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else {
            callback();
        }
    }

    function fetchJson(url) {
        return fetch(url, { cache: 'no-cache' }).then(function (response) {
            if (!response.ok) {
                throw new Error('Réponse HTTP ' + response.status);
            }
            return response.json();
        });
    }

    function fetchText(url) {
        return fetch(url, { cache: 'no-cache' }).then(function (response) {
            if (!response.ok) {
                throw new Error('Réponse HTTP ' + response.status);
            }
            return response.text();
        });
    }

    function fetchBuffer(url) {
        return fetch(url, { cache: 'no-cache' }).then(function (response) {
            if (!response.ok) {
                throw new Error('Réponse HTTP ' + response.status);
            }
            return response.arrayBuffer();
        });
    }

    function decompressIfNeeded(buffer) {
        var bytes = new Uint8Array(buffer);
        if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
            return Promise.resolve(buffer);
        }
        if (typeof window.DecompressionStream !== 'function') {
            return Promise.reject(new Error('Décompression gzip indisponible'));
        }
        var stream = new Blob([buffer]).stream().pipeThrough(
            new window.DecompressionStream('gzip')
        );
        return new Response(stream).arrayBuffer();
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function runLabelUtc(value) {
        var date = new Date(value);
        function two(number) {
            return String(number).padStart(2, '0');
        }
        return two(date.getUTCDate()) + '/' + two(date.getUTCMonth() + 1) +
            ' ' + two(date.getUTCHours()) + 'z';
    }

    function initMap(app) {
        var isInitializing = true;
        var urlInitParams = new URLSearchParams(window.location.search);
        var urlInitModel = urlInitParams.get('model');
        var urlInitLayer = urlInitParams.get('parametre') || urlInitParams.get('layer');
        var urlInitRegion = urlInitParams.get('region');
        var initialModelMap = {
            consensus: { path: 'output/consensus', name: 'CONSENSUS Europe', badge: 'Moyenne' },
            consensus_france: { path: 'output/consensus_france', name: 'CONSENSUS France HD', badge: '0,1°' },
            probabilites: { path: 'output/probabilites', name: 'PROBABILITÉS Europe', badge: '24h' },
            probabilites_france: { path: 'output/probabilites_france', name: 'PROBABILITÉS France', badge: '24h' },
            gfs: { path: 'output/gfs', name: 'GFS Europe', badge: '0,25°' },
            gfs_france: { path: 'output/gfs_france', name: 'GFS France', badge: '0,25°' },
            gfs_antilles: { path: 'output/gfs_antilles', name: 'GFS Arc Antillais', badge: '0,25°' },
            gfs_etats_unis: { path: 'output/gfs_etats_unis', name: 'GFS États-Unis', badge: '0,25°' },
            arpege: { path: 'output/arpege', name: 'ARPEGE Europe', badge: '0,25°' },
            arpege_france: { path: 'output/arpege_france', name: 'ARPEGE France', badge: '0,1°' },
            icon_eu: { path: 'output/icon_eu', name: 'ICON-EU Europe', badge: '7 km' },
            icon_eu_france: { path: 'output/icon_eu_france', name: 'ICON-EU France', badge: '7 km' },
            aifs: { path: 'output/aifs', name: 'ECMWF AIFS Europe', badge: '0,25°' },
            aifs_france: { path: 'output/aifs_france', name: 'ECMWF AIFS France', badge: '0,25°' },
            aifs_antilles: { path: 'output/aifs_antilles', name: 'ECMWF AIFS Arc Antillais', badge: '0,25°' },
            aifs_etats_unis: { path: 'output/aifs_etats_unis', name: 'ECMWF AIFS États-Unis', badge: '0,25°' },
            gfs_ocean_indien: { path: 'output/gfs_ocean_indien', name: 'GFS Océan Indien Sud-Ouest', badge: '0,25°' },
            aifs_ocean_indien: { path: 'output/aifs_ocean_indien', name: 'AIFS Océan Indien Sud-Ouest', badge: '0,25°' },
            gfs_pacifique_ouest: { path: 'output/gfs_pacifique_ouest', name: 'GFS Pacifique Ouest / Typhons', badge: '0,25°' },
            aifs_pacifique_ouest: { path: 'output/aifs_pacifique_ouest', name: 'AIFS Pacifique Ouest / Typhons', badge: '0,25°' },
            gfs_pacifique_sud: { path: 'output/gfs_pacifique_sud', name: 'GFS Pacifique Sud & Océanie', badge: '0,25°' },
            aifs_pacifique_sud: { path: 'output/aifs_pacifique_sud', name: 'AIFS Pacifique Sud & Océanie', badge: '0,25°' },
            gfs_pacifique_est: { path: 'output/gfs_pacifique_est', name: 'GFS Pacifique Est & Hawaï', badge: '0,25°' },
            aifs_pacifique_est: { path: 'output/aifs_pacifique_est', name: 'AIFS Pacifique Est & Hawaï', badge: '0,25°' },
            gfs_ocean_indien_nord: { path: 'output/gfs_ocean_indien_nord', name: 'GFS Bengale & Mer d\'Arabie', badge: '0,25°' },
            aifs_ocean_indien_nord: { path: 'output/aifs_ocean_indien_nord', name: 'AIFS Bengale & Mer d\'Arabie', badge: '0,25°' }
        };
        if (urlInitModel && initialModelMap[urlInitModel]) {
            app.dataset.model = urlInitModel;
            app.dataset.baseUrl = initialModelMap[urlInitModel].path;
            var initTitleSpan = document.querySelector('.amfm-title-text');
            if (initTitleSpan) initTitleSpan.textContent = initialModelMap[urlInitModel].name;
            var initBadge = document.querySelector('.amfm-badge');
            if (initBadge) initBadge.textContent = initialModelMap[urlInitModel].badge;
            var initModelSel = document.getElementById('select-model');
            if (initModelSel) initModelSel.value = urlInitModel;
        }
        if (urlInitLayer) {
            app.dataset.variable = urlInitLayer;
        }

        var baseUrl = (app.dataset.baseUrl || '').replace(/\/+$/, '');
        var requestedLayer = app.dataset.variable || 'temperature';
        var timezone = app.dataset.timezone || 'Europe/Paris';
        var moduleVersion = app.dataset.moduleVersion || '1.0.0';
        var animationEnabled = app.dataset.animation !== '0';
        var reducedMotion = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        var menuToggle = app.querySelector('[data-amfm-menu-toggle]');
        var menuClose = app.querySelector('[data-amfm-menu-close]');
        var layerMenu = app.querySelector('[data-amfm-layer-menu]');
        var layerGrid = app.querySelector('[data-amfm-layer-grid]');
        var currentLayerText = app.querySelector('[data-amfm-current-layer]');
        var previousButton = app.querySelector('[data-amfm-previous]');
        var playButton = app.querySelector('[data-amfm-play]');
        var nextButton = app.querySelector('[data-amfm-next]');
        var validity = app.querySelector('[data-amfm-validity]');
        var lead = app.querySelector('[data-amfm-lead]');
        var run = app.querySelector('[data-amfm-run]');
        var generated = app.querySelector('[data-amfm-generated]');
        var stale = app.querySelector('[data-amfm-stale]');
        var viewport = app.querySelector('[data-amfm-viewport]');
        var weatherCanvas = app.querySelector('[data-amfm-weather]');
        var vectorCanvas = app.querySelector('[data-amfm-vectors]');
        var valuesCanvas = app.querySelector('[data-amfm-values]');
        var labelsCanvas = app.querySelector('[data-amfm-labels]');
        var vectorContext = vectorCanvas ? vectorCanvas.getContext('2d') : null;
        var valuesContext = valuesCanvas ? valuesCanvas.getContext('2d') : null;
        var labelsContext = labelsCanvas ? labelsCanvas.getContext('2d') : null;
        var mapTitle = app.querySelector('[data-amfm-map-title]');
        var mapRun = app.querySelector('[data-amfm-map-run]');
        var mapDate = app.querySelector('[data-amfm-map-date]');
        var loading = app.querySelector('[data-amfm-loading]');
        var errorBox = app.querySelector('[data-amfm-error]');
        var unavailableBox = app.querySelector('[data-amfm-unavailable]');
        var unavailableText = app.querySelector('[data-amfm-unavailable-text]');
        var slider = app.querySelector('[data-amfm-slider]');
        var legend = app.querySelector('[data-amfm-legend]');
        var zoomIn = app.querySelector('[data-amfm-zoom-in]');
        var zoomOut = app.querySelector('[data-amfm-zoom-out]');
        var reset = app.querySelector('[data-amfm-reset]');
        var fullscreen = app.querySelector('[data-amfm-fullscreen]');
        var zoomLevel = app.querySelector('[data-amfm-zoom-level]');
        var probe = app.querySelector('[data-amfm-probe]');
        var probeValue = app.querySelector('[data-amfm-probe-value]');
        var probeLabel = app.querySelector('[data-amfm-probe-label]');
        var toolButtons = app.querySelectorAll('[data-amfm-tool]');
        var toolHint = app.querySelector('[data-amfm-tool-hint]');
        var advancedTools = app.querySelector('[data-amfm-advanced-tools]');
        var captureButton = app.querySelector('[data-amfm-capture]');
        var captureScreenButton = app.querySelector('[data-amfm-capture-screen]') || app.querySelector('[data-amfm-capture-landscape]');
        var captureJpegButton = app.querySelector('[data-amfm-capture-jpeg]');
        var captureGifButton = app.querySelector('[data-amfm-capture-gif]');
        var captureGifScreenButton = app.querySelector('[data-amfm-capture-gif-screen]');
        var captureTiktokButton = app.querySelector('[data-amfm-capture-tiktok]');
        var toggleCitiesButton = app.querySelector('[data-amfm-toggle-cities]');
        var toggleValuesButton = app.querySelector('[data-amfm-toggle-values]');
        var toggleCyclonesButton = app.querySelector('[data-amfm-toggle-cyclones]');
        var btnToggleCycloneCone = document.getElementById('btn-toggle-cyclone-cone');
        var btnToggleCycloneTracks = document.getElementById('btn-toggle-cyclone-tracks');
        var btnToggleCycloneLabels = document.getElementById('btn-toggle-cyclone-labels');
        var btnToggleCycloneNameOnly = document.getElementById('btn-toggle-cyclone-name-only');
        var btnToggleCycloneDetails = document.getElementById('btn-toggle-cyclone-details');
        var toggleSeaButton = app.querySelector('[data-amfm-toggle-sea]');
        var seaSelect = app.querySelector('[data-amfm-select-sea]');
        var pinButton = app.querySelector('[data-amfm-pin]');
        var toggleTvButton = app.querySelector('[data-amfm-toggle-tv]');
        var tvExitButton = app.querySelector('[data-amfm-tv-exit]');
        var toggleDiagramButton = app.querySelector('[data-amfm-toggle-diagram]');

        var meteogramModal = app.querySelector('[data-amfm-meteogram-modal]');
        var meteogramClose = app.querySelector('[data-amfm-meteogram-close]');
        var meteogramCity = app.querySelector('[data-amfm-meteogram-city]');
        var meteogramCoords = app.querySelector('[data-amfm-meteogram-coords]');
        var meteogramCanvas = app.querySelector('[data-amfm-meteogram-canvas]');
        var meteogramTabs = app.querySelectorAll('[data-amfm-meteogram-tab]');
        var meteogramTabActive = 'temperature';
        var meteogramPoint = null;
        var diagramActive = false;


        var mapBadge = app.querySelector('[data-amfm-map-badge]');
        var badgeParam = app.querySelector('[data-amfm-badge-param]');
        var badgeModel = app.querySelector('[data-amfm-badge-model]');
        var badgeDate = app.querySelector('[data-amfm-badge-date]');

        var diagramPopup = app.querySelector('[data-amfm-diagram-popup]');
        var diagramTitle = app.querySelector('[data-amfm-diagram-title]');
        var diagramBody = app.querySelector('[data-amfm-diagram-body]');
        var diagramStatus = app.querySelector('[data-amfm-diagram-status]');
        var diagramClose = app.querySelector('[data-amfm-diagram-close]');

        var manifest = null;
        var currentLayer = requestedLayer;
        var currentModel = app.dataset.model || 'arome';
        var currentStep = 0;
        var loadToken = 0;
        var timer = null;
        var transform = { scale: 1, x: 0, y: 0 };
        var activePointers = new Map();
        var gesture = null;
        var places = [];
        var placeBuckets = new Map();
        var citiesVisible = true;
        var valuesVisible = false;
        var cyclonesVisible = true;
        var cycloneConeVisible = true;
        var cycloneTracksVisible = true;
        // cycloneLabelMode: 'name_only' (par défaut : épuré, idéal téléchargement), 'full' (cartouche complet), 'none' (masqué)
        var cycloneLabelMode = (function () {
            var p = (urlInitParams.get('cyclone_label') || '').toLowerCase();
            if (p === 'full' || p === 'details' || p === 'all') return 'full';
            if (p === 'none' || p === 'off' || p === 'false' || p === '0') return 'none';
            return 'name_only';
        })();
        var cycloneLabelsVisible = (cycloneLabelMode !== 'none');
        var activeCyclonesData = [];
        // seaMode: 'land' par défaut (mer bleue masquée), 'none' (terres & mer partout), 'coast' (terres + littoral)
        var seaMode = (function () {
            var s = (urlInitParams.get('sea') || urlInitParams.get('sea_mode') || '').toLowerCase();
            if (s === 'all' || s === 'none' || s === 'mer' || s === 'both') return 'none';
            if (s === 'coast' || s === 'littoral' || s === 'bord_de_mer') return 'coast';
            return 'land';
        })();
        var vectorDefinition = null;
        var currentWeatherImage = null;
        var logoImage = new Image();
        logoImage.crossOrigin = 'anonymous';
        logoImage.src = (app && app.dataset && app.dataset.logo) ? app.dataset.logo : 'logo.png';
        window.amfmSetLogo = function (src) {
            if (logoImage) logoImage.src = src;
            if (app) app.dataset.logo = src;
        };
        var franceMaskImage = new Image();
        franceMaskImage.crossOrigin = 'anonymous';
        franceMaskImage.src = resolvePath('maps/mask_france.png');
        var maskSamplerCanvas = document.createElement('canvas');
        maskSamplerCanvas.width = 2200;
        maskSamplerCanvas.height = 1640;
        var maskSamplerContext = maskSamplerCanvas.getContext ? maskSamplerCanvas.getContext('2d', { willReadFrequently: true }) : null;
        var maskSamplerReady = false;

        var alphaMaskCanvas = null;
        var alphaMaskVersion = null;
        function isTemperatureLayer(key) {
            if (!key) return false;
            return key === 'temperature' ||
                   key === 'temperature_ressentie' ||
                   key === 'point_rosee' ||
                   key === 'humidex' ||
                   key === 'temperature_min_24h' ||
                   key === 'temperature_max_24h' ||
                   key === 'temperature_850' ||
                   key.indexOf('temp') !== -1;
        }

        function getAlphaMaskCanvas() {
            if (!maskSamplerReady || !maskSamplerCanvas || !maskSamplerContext) return null;
            if (alphaMaskCanvas && alphaMaskVersion === currentModel &&
                alphaMaskCanvas.width === maskSamplerCanvas.width &&
                alphaMaskCanvas.height === maskSamplerCanvas.height) {
                return alphaMaskCanvas;
            }
            try {
                var c = document.createElement('canvas');
                c.width = maskSamplerCanvas.width;
                c.height = maskSamplerCanvas.height;
                var ctx = c.getContext('2d');
                var imgData = maskSamplerContext.getImageData(0, 0, c.width, c.height);
                var d = imgData.data;
                for (var i = 0; i < d.length; i += 4) {
                    d[i + 3] = d[i]; // luminance -> alpha (255 terre, 0 mer)
                }
                ctx.putImageData(imgData, 0, 0);
                alphaMaskCanvas = c;
                alphaMaskVersion = currentModel;
                return alphaMaskCanvas;
            } catch (e) {
                return null;
            }
        }

        franceMaskImage.onload = function () {
            visibleBBoxCache = null;
            alphaMaskCanvas = null;
            if (maskSamplerContext) {
                try {
                    maskSamplerContext.drawImage(franceMaskImage, 0, 0, 2200, 1640);
                    maskSamplerReady = true;
                } catch (e) {}
            }
            scheduleRender();
        };

        function isLand(u, v) {
            if (seaMode === 'none' || !isTemperatureLayer(currentLayer)) return true; // N'applique le masquage marin qu'aux températures
            if (!maskSamplerReady || !maskSamplerContext) return true;
            var px = Math.min(Math.max(0, Math.round(u * 2199)), 2199);
            var py = Math.min(Math.max(0, Math.round(v * 1639)), 1639);
            var pix = maskSamplerContext.getImageData(px, py, 1, 1).data;
            if (pix[0] > 64 || (pix[3] > 64 && pix[0] > 64)) return true;

            if (seaMode === 'coast') {
                // Inclusion généreuse du trait de côte et des zones littorales (~16 km)
                var r = 18;
                var offsets = [
                    [r, 0], [-r, 0], [0, r], [0, -r],
                    [13, 13], [-13, 13], [13, -13], [-13, -13],
                    [r, Math.round(r / 2)], [-r, Math.round(r / 2)], [Math.round(r / 2), r], [Math.round(r / 2), -r]
                ];
                for (var i = 0; i < offsets.length; i++) {
                    var nx = Math.min(Math.max(0, px + offsets[i][0]), 2199);
                    var ny = Math.min(Math.max(0, py + offsets[i][1]), 1639);
                    var npix = maskSamplerContext.getImageData(nx, ny, 1, 1).data;
                    if (npix[0] > 64 || (npix[3] > 64 && npix[0] > 64)) {
                        return true;
                    }
                }
            }
            return false;
        }
        // Fond de carte (pays voisins inclus, style Positron)
        var fondImageElement = new Image();
        fondImageElement.crossOrigin = 'anonymous';
        fondImageElement.src = resolvePath('maps/fond.webp');
        var currentProbe = null;
        var probeLoadToken = 0;
        var samplerCanvas = document.createElement('canvas');
        var samplerContext = samplerCanvas.getContext ? samplerCanvas.getContext(
            '2d', { willReadFrequently: true }
        ) : null;
        var samplerReady = false;
        var hoverFrame = null;
        var lastHover = null;
        var renderFrame = null;
        var webgl = null;
        var fallbackContext = null;
        var maxScale = 64;
        var pendingFocus = null;
        var toolMode = null;
        var pinnedEnabled = false;
        var pinnedPoint = null;
        var tapStart = null;
        var departmentCache = new Map();
        var diagramLoadToken = 0;

        var validityFormat;
        var runFormat;
        var mapDateFormat;
        try {
            validityFormat = new Intl.DateTimeFormat('fr-FR', {
                timeZone: timezone,
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
            });
            runFormat = new Intl.DateTimeFormat('fr-FR', {
                timeZone: timezone,
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
            });
            mapDateFormat = new Intl.DateTimeFormat('fr-FR', {
                timeZone: timezone,
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
            });
        } catch (formatError) {
            validityFormat = new Intl.DateTimeFormat('fr-FR');
            runFormat = validityFormat;
            mapDateFormat = validityFormat;
        }

        function resolvePath(path) {
            if (/^(?:https?:\/\/|data:|blob:)/i.test(path || '')) {
                return path;
            }
            if (path && (String(path).indexOf('config/') === 0 || String(path).indexOf('js/') === 0)) {
                return String(path).replace(/^\/+/, '');
            }
            return baseUrl + '/' + String(path || '').replace(/^\/+/, '');
        }

        function versioned(path) {
            if (/^(?:data:|blob:)/i.test(path || '')) {
                return String(path);
            }
            var separator = String(path).indexOf('?') === -1 ? '?' : '&';
            var version = manifest && manifest.generated_at ? manifest.generated_at : Date.now();
            return resolvePath(path) + separator + 'v=' + encodeURIComponent(version);
        }

        function showError(message) {
            stopAnimation();
            if (loading) loading.hidden = true;
            if (errorBox) {
                errorBox.textContent = message;
                errorBox.hidden = false;
            }
        }

        function clearError() {
            if (errorBox) {
                errorBox.hidden = true;
                errorBox.textContent = '';
            }
        }

        function parseProbe(buffer) {
            if (!buffer || buffer.byteLength < 16) {
                throw new Error('grille de valeurs tronquée');
            }
            var view = new DataView(buffer);
            var signature = String.fromCharCode(
                view.getUint8(0),
                view.getUint8(1),
                view.getUint8(2),
                view.getUint8(3)
            );
            var width = view.getUint16(4, true);
            var height = view.getUint16(6, true);
            if (signature !== 'HKV1' || !width || !height ||
                    buffer.byteLength < 16 + width * height * 2) {
                throw new Error('grille de valeurs invalide');
            }
            return {
                view: view,
                width: width,
                height: height,
                minimum: view.getFloat32(8, true),
                maximum: view.getFloat32(12, true)
            };
        }

        function probeCell(grid, x, y) {
            var code = grid.view.getUint16(
                16 + (y * grid.width + x) * 2,
                true
            );
            if (code === 65535) {
                return null;
            }
            return grid.minimum + code / 65534 *
                (grid.maximum - grid.minimum);
        }

        function sampleProbe(grid, u, v) {
            if (!grid) {
                return null;
            }
            var x = clamp(u, 0, 1) * (grid.width - 1);
            var y = clamp(v, 0, 1) * (grid.height - 1);
            var x0 = Math.floor(x);
            var y0 = Math.floor(y);
            var x1 = Math.min(x0 + 1, grid.width - 1);
            var y1 = Math.min(y0 + 1, grid.height - 1);
            var fx = x - x0;
            var fy = y - y0;
            var samples = [
                [x0, y0, (1 - fx) * (1 - fy)],
                [x1, y0, fx * (1 - fy)],
                [x0, y1, (1 - fx) * fy],
                [x1, y1, fx * fy]
            ];
            var total = 0;
            var weight = 0;
            samples.forEach(function (entry) {
                var value = probeCell(grid, entry[0], entry[1]);
                if (value === null || entry[2] <= 0) {
                    return;
                }
                total += value * entry[2];
                weight += entry[2];
            });
            return weight > 0 ? total / weight : null;
        }

        function parseColour(value) {
            var clean = String(value || '').replace('#', '');
            if (!/^[0-9a-f]{6}$/i.test(clean)) {
                return [0, 0, 0];
            }
            return [
                parseInt(clean.slice(0, 2), 16),
                parseInt(clean.slice(2, 4), 16),
                parseInt(clean.slice(4, 6), 16)
            ];
        }

        function valueFromColour(red, green, blue, layer) {
            if (!layer || !Array.isArray(layer.stops) || layer.stops.length < 2) {
                return null;
            }
            var stops = layer.stops.map(function (stop) {
                return {
                    value: Number(stop.value),
                    colour: parseColour(stop.color)
                };
            });
            var target = [red, green, blue];
            var bestValue = null;
            var bestDistance = Infinity;
            for (var index = 0; index < stops.length - 1; index += 1) {
                var first = stops[index];
                var second = stops[index + 1];
                var fraction = 0;
                if (!layer.discrete) {
                    var dr = second.colour[0] - first.colour[0];
                    var dg = second.colour[1] - first.colour[1];
                    var db = second.colour[2] - first.colour[2];
                    var denominator = dr * dr + dg * dg + db * db;
                    if (denominator > 0) {
                        fraction = clamp(
                            ((target[0] - first.colour[0]) * dr +
                                (target[1] - first.colour[1]) * dg +
                                (target[2] - first.colour[2]) * db) /
                                denominator,
                            0,
                            1
                        );
                    }
                }
                var candidate = [
                    first.colour[0] + (second.colour[0] - first.colour[0]) * fraction,
                    first.colour[1] + (second.colour[1] - first.colour[1]) * fraction,
                    first.colour[2] + (second.colour[2] - first.colour[2]) * fraction
                ];
                var distance = Math.pow(target[0] - candidate[0], 2) +
                    Math.pow(target[1] - candidate[1], 2) +
                    Math.pow(target[2] - candidate[2], 2);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestValue = first.value +
                        (second.value - first.value) * fraction;
                }
            }
            return bestValue;
        }

        function prepareImageSampler(source) {
            samplerReady = false;
            if (!samplerContext || !source) {
                return;
            }
            var width = Number(source.naturalWidth || source.width ||
                (manifest && manifest.width) || 0);
            var height = Number(source.naturalHeight || source.height ||
                (manifest && manifest.height) || 0);
            if (!width || !height) {
                return;
            }
            try {
                samplerCanvas.width = width;
                samplerCanvas.height = height;
                samplerContext.clearRect(0, 0, width, height);
                samplerContext.drawImage(source, 0, 0, width, height);
                samplerReady = true;
            } catch (samplingError) {
                samplerReady = false;
            }
        }

        function samplePalette(u, v, layer) {
            if (!samplerReady || !samplerContext) {
                return null;
            }
            var x = clamp(Math.round(u * (samplerCanvas.width - 1)),
                0, samplerCanvas.width - 1);
            var y = clamp(Math.round(v * (samplerCanvas.height - 1)),
                0, samplerCanvas.height - 1);
            try {
                var pixel = samplerContext.getImageData(x, y, 1, 1).data;
                if (pixel[3] < 12) {
                    return layer.transparent_below !== null &&
                        layer.transparent_below !== undefined ? 0 : null;
                }
                return valueFromColour(pixel[0], pixel[1], pixel[2], layer);
            } catch (samplingError) {
                samplerReady = false;
                return null;
            }
        }

        function loadProbe(step) {
            var token = ++probeLoadToken;
            currentProbe = null;
            var path = step && step.probes && step.probes[currentLayer];
            if (!path) {
                return Promise.resolve();
            }
            return fetchBuffer(versioned(path))
                .then(decompressIfNeeded)
                .then(parseProbe)
                .then(function (grid) {
                    if (token !== probeLoadToken) {
                        return;
                    }
                    currentProbe = grid;
                    if (lastHover) {
                        updateProbe(lastHover.x, lastHover.y);
                    }
                    if (valuesVisible) {
                        scheduleRender();
                    }
                })
                .catch(function () {
                    if (token === probeLoadToken) {
                        currentProbe = null;
                    }
                });
        }

        function hideProbe() {
            lastHover = null;
            if (hoverFrame !== null && window.cancelAnimationFrame) {
                window.cancelAnimationFrame(hoverFrame);
                hoverFrame = null;
            }
            if (probe) {
                probe.hidden = true;
                probe.classList.remove('active');
            }
        }

        function pointerMapPosition(clientX, clientY) {
            var box = viewport.getBoundingClientRect();
            var screenX = clientX - box.left;
            var screenY = clientY - box.top;
            // Projection UNIQUE (computeMapRect) : identique au raster et aux
            // vecteurs → la sonde lit exactement ce qui est affiché.
            var mapRect = computeMapRect(box.width, box.height);
            var u = (screenX - mapRect.x) / mapRect.w;
            var v = (screenY - mapRect.y) / mapRect.h;
            if (u < 0 || u > 1 || v < 0 || v > 1) {
                return null;
            }
            return {
                screenX: screenX,
                screenY: screenY,
                u: u,
                v: v,
                width: box.width,
                height: box.height
            };
        }

        function updateProbe(clientX, clientY) {
            if (!probe || !probeValue || !probeLabel || !manifest ||
                    !currentWeatherImage) {
                hideProbe();
                return;
            }
            lastHover = { x: clientX, y: clientY };
            var position = pointerMapPosition(clientX, clientY);
            var layer = manifest.layers[currentLayer];
            if (!position || !layer) {
                probe.hidden = true;
                return;
            }
            if (!isLand(position.u, position.v)) {
                hideProbe();
                return;
            }
            var value = sampleProbe(currentProbe, position.u, position.v);
            var estimated = false;
            if (value === null) {
                value = samplePalette(position.u, position.v, layer);
                estimated = value !== null;
            }
            if (value === null || !Number.isFinite(value)) {
                probe.hidden = true;
                return;
            }
            var decimals = clamp(Number(layer.decimals) || 0, 0, 2);
            var formatted = Number(value).toLocaleString('fr-FR', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            });
            probeValue.textContent = (estimated ? '≈ ' : '') + formatted +
                (layer.unit ? ' ' + layer.unit : '');
            probeLabel.textContent = layer.label || currentLayer;
            probe.hidden = false;
            probe.classList.add('active');

            var tooltipWidth = probe.offsetWidth || 170;
            var tooltipHeight = probe.offsetHeight || 54;
            var left = position.screenX + 16;
            var top = position.screenY + 16;
            if (left + tooltipWidth > position.width - 8) {
                left = position.screenX - tooltipWidth - 16;
            }
            if (top + tooltipHeight > position.height - 8) {
                top = position.screenY - tooltipHeight - 16;
            }
            probe.style.left = Math.max(8, left) + 'px';
            probe.style.top = Math.max(8, top) + 'px';
        }

        var pinnedElement = null;

        function clearPinned() {
            if (pinnedElement && pinnedElement.parentNode) {
                pinnedElement.parentNode.removeChild(pinnedElement);
            }
            pinnedElement = null;
            pinnedPoint = null;
        }

        function positionPinned() {
            if (!pinnedElement || !pinnedPoint || !viewport) {
                return;
            }
            var box = viewport.getBoundingClientRect();
            // Projection UNIQUE (computeMapRect) : l'épingle reste collée au
            // point exact du raster, cohérente avec la sonde et l'affichage.
            var mapRect = computeMapRect(box.width, box.height);
            var screenX = mapRect.x + pinnedPoint.u * mapRect.w;
            var screenY = mapRect.y + pinnedPoint.v * mapRect.h;
            if (screenX < -40 || screenX > box.width + 40 || screenY < -40 || screenY > box.height + 40) {
                pinnedElement.style.display = 'none';
                return;
            }
            pinnedElement.style.display = '';
            var width = pinnedElement.offsetWidth || 170;
            var height = pinnedElement.offsetHeight || 54;
            var left = screenX + 14;
            var top = screenY - height - 14;
            if (left + width > box.width - 8) {
                left = screenX - width - 14;
            }
            if (top < 8) {
                top = screenY + 14;
            }
            pinnedElement.style.left = Math.max(8, Math.min(left, box.width - width - 8)) + 'px';
            pinnedElement.style.top = Math.max(8, Math.min(top, box.height - height - 8)) + 'px';
        }

        function pinProbeAt(clientX, clientY) {
            if (!manifest || !currentWeatherImage) {
                return;
            }
            var position = pointerMapPosition(clientX, clientY);
            var layer = manifest.layers[currentLayer];
            if (!position || !layer) {
                return;
            }
            var value = sampleProbe(currentProbe, position.u, position.v);
            var estimated = false;
            if (value === null) {
                value = samplePalette(position.u, position.v, layer);
                estimated = value !== null;
            }
            if (value === null || !Number.isFinite(value)) {
                return;
            }
            clearPinned();
            var decimals = clamp(Number(layer.decimals) || 0, 0, 2);
            var formatted = Number(value).toLocaleString('fr-FR', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            });
            pinnedElement = document.createElement('div');
            pinnedElement.className = 'amfm-probe amfm-probe-pinned';
            var strong = document.createElement('strong');
            strong.textContent = (estimated ? '≈ ' : '') + formatted + (layer.unit ? ' ' + layer.unit : '');
            var label = document.createElement('span');
            label.textContent = layer.label || currentLayer;
            var close = document.createElement('button');
            close.type = 'button';
            close.className = 'amfm-probe-pin-close';
            close.setAttribute('aria-label', 'Retirer l’épingle');
            close.textContent = '×';
            close.addEventListener('click', function (event) {
                event.stopPropagation();
                clearPinned();
            });
            pinnedElement.appendChild(strong);
            pinnedElement.appendChild(label);
            pinnedElement.appendChild(close);
            viewport.appendChild(pinnedElement);
            pinnedPoint = { u: position.u, v: position.v };
            positionPinned();
        }

        function screenToLatLon(clientX, clientY) {
            if (!manifest || !manifest.bounds) {
                return null;
            }
            var position = pointerMapPosition(clientX, clientY);
            if (!position) {
                return null;
            }
            var bounds = manifest.bounds;
            var west = Number(bounds.west);
            var east = Number(bounds.east);
            var northY = mercator(Number(bounds.north));
            var southY = mercator(Number(bounds.south));
            return {
                latitude: inverseMercator(northY - position.v * (northY - southY)),
                longitude: west + position.u * (east - west)
            };
        }

        function nearestPlace(latitude, longitude) {
            if (!placeBuckets.size) {
                return null;
            }
            var baseLat = Math.floor(latitude);
            var baseLon = Math.floor(longitude);
            var best = null;
            var bestDistance = Infinity;
            for (var dLat = -2; dLat <= 2; dLat += 1) {
                for (var dLon = -2; dLon <= 2; dLon += 1) {
                    var bucket = placeBuckets.get((baseLat + dLat) + '|' + (baseLon + dLon));
                    if (!bucket) {
                        continue;
                    }
                    for (var index = 0; index < bucket.length; index += 1) {
                        var place = bucket[index];
                        var placeLat = Number(place[2]);
                        var placeLon = Number(place[3]);
                        var dy = placeLat - latitude;
                        var dx = (placeLon - longitude) * Math.cos(latitude * Math.PI / 180);
                        var distance = dx * dx + dy * dy;
                        if (distance < bestDistance) {
                            bestDistance = distance;
                            best = place;
                        }
                    }
                }
            }
            return best;
        }

        function setToolHint(message) {
            if (!toolHint) {
                return;
            }
            toolHint.textContent = message || '';
            toolHint.hidden = !message;
        }

        function setToolMode(mode) {
            toolMode = toolMode === mode ? null : mode;
            toolButtons.forEach(function (button) {
                var active = button.dataset.amfmTool === toolMode;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
            if (advancedTools) {
                advancedTools.hidden = toolMode !== 'zoom';
            }
            if (toolMode !== 'zoom' && pinnedEnabled) {
                pinnedEnabled = false;
                if (pinButton) {
                    pinButton.setAttribute('aria-pressed', 'false');
                }
                clearPinned();
            }
            if (toolMode === 'diagram') {
                setToolHint('Cliquez sur la carte pour afficher le diagramme AROME du point choisi.');
            } else {
                setToolHint('');
                closeDiagram();
            }
        }

        // Scanne le masque France (2200×1640) et retourne le rectangle englobant
        // des pixels effectivement couverts (valeur > 0). Permet un cadrage
        // d'export qui ne montre JAMAIS de zone vide (coins du trapèze AROME,
        // mer, pays voisins non maillés) : le cadre suit la donnée réelle.
        var visibleBBoxCache = null;
        function computeVisibleBBox() {
            if (visibleBBoxCache) {
                return visibleBBoxCache;
            }
            if (!franceMaskImage || !franceMaskImage.complete || !franceMaskImage.naturalWidth) {
                return null;
            }
            var mw = franceMaskImage.naturalWidth;
            var mh = franceMaskImage.naturalHeight;
            if (mw < 2 || mh < 2) {
                return null;
            }
            try {
                var mc = document.createElement('canvas');
                mc.width = mw;
                mc.height = mh;
                var mctx = mc.getContext('2d', { willReadFrequently: true });
                if (!mctx) {
                    return null;
                }
                mctx.drawImage(franceMaskImage, 0, 0);
                var data = mctx.getImageData(0, 0, mw, mh).data;
                var x0 = mw, y0 = mh, x1 = -1, y1 = -1;
                // Balayage par pas de 2 puis affinage : 2200×1640 pixels = 3,6 M
                // de lectures, quelques dizaines de ms suffisent en pas de 2.
                for (var y = 0; y < mh; y += 2) {
                    var row = y * mw * 4;
                    for (var x = 0; x < mw; x += 2) {
                        if (data[row + x * 4 + 3] > 8) {
                            if (x < x0) x0 = x;
                            if (x > x1) x1 = x;
                            if (y < y0) y0 = y;
                            if (y > y1) y1 = y;
                        }
                    }
                }
                if (x1 < 0) {
                    return null;
                }
                // Affinage sur la bande de 1 px autour du bbox grossier.
                var xa = Math.max(0, x0 - 2), xb = Math.min(mw - 1, x1 + 2);
                var ya = Math.max(0, y0 - 2), yb = Math.min(mh - 1, y1 + 2);
                for (var yy = ya; yy <= yb; yy++) {
                    var rr = yy * mw * 4;
                    for (var xx = xa; xx <= xb; xx++) {
                        if (data[rr + xx * 4 + 3] > 8) {
                            if (xx < x0) x0 = xx;
                            if (xx > x1) x1 = xx;
                            if (yy < y0) y0 = yy;
                            if (yy > y1) y1 = yy;
                        }
                    }
                }
                visibleBBoxCache = { x0: x0, y0: y0, x1: x1, y1: y1 };
                return visibleBBoxCache;
            } catch (e) {
                return null;
            }
        }

        function composeCaptureCanvas(customStep, customImage, isScreen) {
            var activeImg = customImage || currentWeatherImage;
            var vw = viewport.clientWidth;
            var vh = viewport.clientHeight;
            if (!vw || !vh) {
                return null;
            }

            var isWorld = isWorldDomain();
            var natH = isWorld ? 1320.0 : 1640.0;
            var outW, outH, hScale, vScale, offX, offY;

            if (isScreen) {
                // Capture d'écran HD EXACTE : reproduction au pixel près de la vue affichée à l'écran (x2 pour netteté Retina/4K)
                var ratio = 2.0;
                outW = Math.round(vw * ratio);
                outH = Math.round(vh * ratio);
                var mapRect = computeMapRect(vw, vh);
                hScale = (mapRect.w / 2200.0) * ratio;
                vScale = (mapRect.h / natH) * ratio;
                offX = mapRect.x * ratio;
                offY = mapRect.y * ratio;
            } else {
                var isEuropeExport = isEuropeDomain();
                var isFranceExport = !isEuropeExport && !isWorld;

                if (transform.scale > 1.08) {
                    // 🌟 Vue zoomée (qu'on soit en France, en Europe ou sur un domaine mondial : reproduction HD exacte du cadrage actif)
                    outW = 2200;
                    outH = Math.round(natH);
                    var viewRect = computeMapRect(vw, vh);
                    var u0 = (0 - viewRect.x) / viewRect.w;
                    var u1 = (vw - viewRect.x) / viewRect.w;
                    var v0 = (0 - viewRect.y) / viewRect.h;
                    var v1 = (vh - viewRect.y) / viewRect.h;
                    var vueW = Math.max(0.01, u1 - u0);
                    var vueH = Math.max(0.01, v1 - v0);
                    var k = Math.max(outW / (vueW * 2200.0), outH / (vueH * natH));
                    hScale = k;
                    vScale = k;
                    var uc = (u0 + u1) / 2;
                    var vc = (v0 + v1) / 2;
                    offX = outW / 2 - uc * 2200.0 * k;
                    offY = outH / 2 - vc * natH * k;
                } else if (isEuropeExport || isWorld) {
                    // Vue globale standard Europe ou Monde (Antilles, USA, Océan Indien)
                    outW = 2200;
                    outH = Math.round(natH);
                    hScale = 1.0;
                    vScale = 1.0;
                    offX = 0;
                    offY = 0;
                } else if (isFranceExport) {
                    // Vue France entière : boîte Météo-NPDC (West: -5.8°, East: +10.2°, North: 51.6°, South: 41.1°)
                    outW = 2200;
                    outH = 1640;
                    var fx0 = 270;  // Ouest Bretagne
                    var fx1 = 1870; // Est Corse
                    var fy0 = 125;  // Nord Mer du Nord / Sud Angleterre
                    var fy1 = 1460; // Sud Bonifacio
                    var fw = fx1 - fx0; // 1600
                    var fh = fy1 - fy0; // 1335
                    var scale = Math.min(outW / fw, outH / fh);
                    hScale = scale;
                    vScale = scale;
                    var cx = (fx0 + fx1) / 2; // 1070
                    var cy = (fy0 + fy1) / 2; // 792.5
                    offX = outW / 2 - cx * scale;
                    offY = outH / 2 - cy * scale;
                }
            }

            // Zone réellement couverte par la carte dans le canvas d'export
            var mapRect = {
                left: Math.max(0, offX),
                right: Math.min(outW, offX + 2200 * hScale),
                top: Math.max(0, offY),
                bottom: Math.min(outH, offY + (isWorld ? 1320.0 : 1640.0) * vScale)
            };
            if (mapRect.right <= mapRect.left || mapRect.bottom <= mapRect.top) {
                mapRect = { left: 0, right: outW, top: 0, bottom: outH };
            }

            var output = document.createElement('canvas');
            output.width = outW;
            output.height = outH;
            var context = output.getContext('2d');

            // Fond sombre du domaine (#0b1220)
            context.fillStyle = '#0b1220';
            context.fillRect(0, 0, output.width, output.height);

            // Fond de carte terres/mers (clip plein écran)
            context.save();
            context.beginPath();
            context.rect(0, 0, outW, outH);
            context.clip();
            var shouldMaskSea = (seaMode === 'land' && isTemperatureLayer(currentLayer));
            if (shouldMaskSea) {
                context.save();
                context.transform(hScale, 0, 0, vScale, offX, offY);
                context.fillStyle = '#1c4280';
                context.fillRect(0, 0, 2200, isWorld ? 1320.0 : 1640.0);
                if (fondImageElement && fondImageElement.complete && fondImageElement.naturalWidth) {
                    var aMask = getAlphaMaskCanvas();
                    if (aMask) {
                        var fCan = document.createElement('canvas');
                        fCan.width = 2200;
                        fCan.height = isWorld ? 1320 : 1640;
                        var fCtx = fCan.getContext('2d');
                        fCtx.drawImage(fondImageElement, 0, 0);
                        fCtx.save();
                        fCtx.globalCompositeOperation = 'destination-in';
                        fCtx.drawImage(aMask, 0, 0);
                        fCtx.restore();
                        context.drawImage(fCan, 0, 0);
                    } else {
                        context.drawImage(fondImageElement, 0, 0);
                    }
                }
                context.restore();
            } else {
                if (fondImageElement && fondImageElement.complete && fondImageElement.naturalWidth) {
                    context.save();
                    context.transform(hScale, 0, 0, vScale, offX, offY);
                    context.drawImage(fondImageElement, 0, 0);
                    context.restore();
                } else {
                    context.fillStyle = '#8fa3b8';
                    context.fillRect(0, 0, output.width, output.height);
                }
            }

            // Dalle météo (si disponible)
            if (activeImg && activeImg.complete && activeImg.naturalWidth) {
                var weatherMasked = document.createElement('canvas');
                weatherMasked.width = output.width;
                weatherMasked.height = output.height;
                var weatherCtx = weatherMasked.getContext('2d');
                weatherCtx.save();
                weatherCtx.transform(hScale, 0, 0, vScale, offX, offY);
                weatherCtx.drawImage(activeImg, 0, 0);
                if (seaMode === 'land' && isTemperatureLayer(currentLayer)) {
                    var aMask = getAlphaMaskCanvas();
                    if (aMask) {
                        weatherCtx.globalCompositeOperation = 'destination-in';
                        weatherCtx.drawImage(aMask, 0, 0);
                    }
                }
                weatherCtx.restore();
                context.drawImage(weatherMasked, 0, 0);
            } else {
                // Paramètre non disponible : badge central discret sur le fond vierge
                context.save();
                context.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                var msg = 'PARAMÈTRE NON DISPONIBLE POUR CE MODÈLE';
                var tw = context.measureText(msg).width + 64;
                var th = 60;
                var cx = output.width / 2;
                var cy = output.height / 2;
                context.fillStyle = 'rgba(11, 18, 32, 0.92)';
                context.beginPath();
                if (typeof context.roundRect === 'function') {
                    context.roundRect(cx - tw / 2, cy - th / 2, tw, th, 12);
                } else {
                    context.rect(cx - tw / 2, cy - th / 2, tw, th);
                }
                context.fill();
                context.strokeStyle = 'rgba(0, 210, 255, 0.6)';
                context.lineWidth = 2;
                context.stroke();
                context.fillStyle = '#00d2ff';
                context.fillText(msg, cx, cy);
                context.restore();
            }

            // Frontières vectorielles uniques (noir franc 100% net pour France/AROME, adapté Europe)
            if (vectorDefinition && vectorDefinition.paths && vectorDefinition.paths.length) {
                context.save();
                context.transform(hScale, 0, 0, vScale, offX, offY);
                var isFrance = (currentModel.indexOf('_france') !== -1) || (manifest && manifest.bounds && manifest.bounds.projection === 'mercator');
                if (isFrance) {
                    // Copie conforme du moteur AROME : noir franc #05080c, hdStrokeFactor 2.4, départements 100% visibles
                    var hdStrokeFactor = 2.4;
                    vectorDefinition.paths.forEach(function (entry) {
                        context.strokeStyle = '#05080c';
                        context.globalAlpha = 1.0;
                        context.lineCap = 'round';
                        context.lineJoin = 'round';
                        context.lineWidth = ((entry.width || 1.6) * hdStrokeFactor) / hScale;
                        context.stroke(entry.path);
                    });
                } else {
                    // Domaine Europe : synoptique
                    var hdStrokeFactor = 1.8;
                    vectorDefinition.paths.forEach(function (entry) {
                        var isDept = entry.kind === 'department';
                        if (isDept && transform.scale <= 1.35) {
                            return;
                        }
                        context.strokeStyle = entry.colour || (isDept ? '#7a828e' : '#0b1220');
                        context.globalAlpha = isDept ? 0.85 : (entry.opacity || 1.0);
                        context.lineCap = 'round';
                        context.lineJoin = 'round';
                        context.lineWidth = ((entry.width || (isDept ? 0.8 : 1.8)) * hdStrokeFactor) / hScale;
                        context.stroke(entry.path);
                    });
                }
                context.restore();
                context.globalAlpha = 1;
            }
            context.restore(); // Fin clip carte

            // Logo Météo-Climat Pro officiel (en haut à droite, pur PNG sans cadre noir)
            var margin = 32;
            var bannerY = 36;
            var bannerH = 135;

            context.save();
            if (logoImage && logoImage.complete && logoImage.naturalWidth) {
                var logoTargetW = 380;
                var logoTargetH = Math.round(logoTargetW * logoImage.naturalHeight / logoImage.naturalWidth);
                // Logo toujours à l'intérieur de la zone carte (jamais sur le fond noir)
                var lx = Math.min(output.width - margin - logoTargetW, mapRect.right - margin - logoTargetW);
                var ly = Math.max(mapRect.top + 8, bannerY + (bannerH - logoTargetH) / 2);
                context.shadowColor = 'rgba(0, 0, 0, 0.75)';
                context.shadowBlur = 12;
                context.shadowOffsetX = 2;
                context.shadowOffsetY = 2;
                context.drawImage(logoImage, lx, ly, logoTargetW, logoTargetH);
            } else {
                context.textAlign = 'right';
                context.textBaseline = 'top';
                context.font = '800 38px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                context.fillStyle = '#ffffff';
                context.shadowColor = 'rgba(0, 0, 0, 0.85)';
                context.shadowBlur = 8;
                context.fillText('MÉTÉO-CLIMAT', output.width - margin, bannerY + 20);
                context.font = '900 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                context.fillStyle = '#00d2ff';
                context.fillText('PRO', output.width - margin, bannerY + 68);
            }
            context.restore();

            // Cartouche d'antenne (en haut à gauche)
            var layer = manifest && manifest.layers && manifest.layers[currentLayer];
            var step = customStep || availableSteps()[currentStep];
            var prettyLabel = layer ? layer.label : '';
            var prettyUnit = layer && layer.unit ? layer.unit : '';
            if (typeof window.getLayerPalette === 'function') {
                try {
                    var prettyPal = window.getLayerPalette(currentLayer);
                    if (prettyPal) {
                        prettyLabel = prettyPal.label || prettyLabel;
                        prettyUnit = prettyPal.unit !== undefined ? prettyPal.unit : prettyUnit;
                    }
                } catch (e) {}
            }

            var dateStr = '';
            if (step) {
                try {
                    dateStr = validityFormat.format(new Date(step.valid_time)).replace(':', 'h');
                } catch (e) {
                    dateStr = new Date(step.valid_time).toLocaleDateString('fr-FR');
                }
            }

            var margin = 24;
            var bannerY = 24;
            var bannerH = 175;
            var modelTitle = (manifest && manifest.model_name) ? manifest.model_name : 'AROME HD';
            var paramTitle = prettyLabel + (prettyUnit ? ' (' + prettyUnit + ')' : '');
            var runLabel = '';
            if (manifest && manifest.run_time) {
                try {
                    runLabel = 'Run ' + String(manifest.run_time).slice(11, 16) + 'Z';
                } catch (e) {}
            }
            var dateText = dateStr + (step ? ' (H+' + String(step.lead_hour).padStart(2, '0') + ')' : '');
            var modelAndRun = modelTitle + (runLabel ? ' • ' + runLabel : '');

            context.font = '700 38px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            var w1 = context.measureText(paramTitle).width;
            context.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            var w2 = context.measureText(modelAndRun).width;
            context.font = '800 34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            var w3 = context.measureText(dateText).width;
            var bannerW = Math.max(w1, w2, w3) + 48;

            // Cartouche toujours à l'intérieur de la zone carte (jamais sur le fond noir)
            var cartLeft = Math.max(margin, mapRect.left + margin);
            var cartTop = Math.max(bannerY, mapRect.top + bannerY);
            bannerW = Math.min(bannerW, Math.max(120, mapRect.right - cartLeft - margin));
            bannerH = Math.min(bannerH, Math.max(60, mapRect.bottom - cartTop - margin));

            context.fillStyle = 'rgba(7, 11, 20, 0.92)';
            context.beginPath();
            if (typeof context.roundRect === 'function') {
                context.roundRect(cartLeft, cartTop, bannerW, bannerH, 16);
            } else {
                context.rect(cartLeft, cartTop, bannerW, bannerH);
            }
            context.fill();
            context.strokeStyle = 'rgba(0, 210, 255, 0.8)';
            context.lineWidth = 3;
            context.stroke();

            // 1. Titre du paramètre météo (en premier, blanc franc)
            context.fillStyle = '#ffffff';
            context.font = '700 38px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            context.textAlign = 'left';
            context.textBaseline = 'alphabetic';
            context.fillText(paramTitle, cartLeft + 24, cartTop + 48);

            // 2. Modèle météo & Run (en dessous, cyan éclatant)
            context.fillStyle = '#00d2ff';
            context.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            context.fillText(modelAndRun, cartLeft + 24, cartTop + 88);

            // 3. Date & Échéance (en dessous, GRAND, blanc éclatant avec accent cyan)
            context.fillStyle = '#ffffff';
            context.font = '800 34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            context.fillText(dateText, cartLeft + 24, cartTop + 140);

            // Légende colorimétrique officielle en bas
            // (Z500 : légende intégrée dans l'image elle-même → pas de surimpression)
            var legendY = 0, legendX = 0, legendW = 0, legendH = 0;
            var z500HasEmbeddedLegend = (currentLayer === 'geopotentiel_500' || currentLayer === 'geopotentiel_500_meteociel');
            if (layer && !z500HasEmbeddedLegend && typeof window.getLayerPalette === 'function' && typeof window.paletteTicks === 'function') {
                try {
                    // Légende toujours à l'intérieur de la zone carte (jamais sur le fond noir)
                    legendW = Math.min(1100, Math.max(200, mapRect.right - mapRect.left - 48));
                    legendH = 96;
                    var legendBottom = 24;
                    legendX = mapRect.left + (mapRect.right - mapRect.left - legendW) / 2;
                    legendY = Math.max(mapRect.top, mapRect.bottom - legendH - legendBottom);

                    context.fillStyle = 'rgba(7, 11, 20, 0.95)';
                    context.beginPath();
                    if (typeof context.roundRect === 'function') {
                        context.roundRect(legendX - 22, legendY - 10, legendW + 44, legendH + 30, 18);
                    } else {
                        context.rect(legendX - 22, legendY - 10, legendW + 44, legendH + 30);
                    }
                    context.fill();
                    context.strokeStyle = 'rgba(0, 210, 255, 0.7)';
                    context.lineWidth = 2.5;
                    context.stroke();

                    // Étiquette
                    context.fillStyle = '#ffffff';
                    context.font = '700 30px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    context.textAlign = 'center';
                    context.textBaseline = 'alphabetic';
                    context.fillText(prettyLabel + (prettyUnit ? ' (' + prettyUnit + ')' : ''), legendX + legendW / 2, legendY + 30);

                    // Barre
                    var pal = window.getLayerPalette(currentLayer);
                    var stops = pal && pal.stops ? pal.stops : [];
                    var low = (pal && pal.transparent_below !== null && pal.transparent_below !== undefined) ? pal.transparent_below : (stops.length ? stops[0].value : 0);
                    var max = stops.length ? stops[stops.length - 1].value : 1;
                    var span = (max - low) || 1;
                    var barY = legendY + 44;
                    var isDiscreteZ500 = (currentLayer === 'geopotentiel_500' || currentLayer === 'geopotentiel_500_meteociel');
                    if (isDiscreteZ500 && stops.length > 1) {
                        // Z500 : BANDES DISCRÈTES de 4 dam (style Météociel),
                        // chaque classe reçoit la couleur pleine de son seuil bas.
                        var segW = legendW / (stops.length - 1);
                        for (var si = 0; si < stops.length - 1; si++) {
                            context.fillStyle = stops[si].color;
                            context.fillRect(legendX + si * segW, barY, segW + 0.5, 24);
                        }
                    } else {
                        var gradient = context.createLinearGradient(legendX, 0, legendX + legendW, 0);
                        if (pal && pal.transparent_below !== null && pal.transparent_below !== undefined) {
                            gradient.addColorStop(0, 'rgba(0,0,0,0)');
                        }
                        stops.forEach(function (s) {
                            var pos = Math.max(0, Math.min(1, (Number(s.value) - low) / span));
                            gradient.addColorStop(pos, s.color);
                        });
                        context.fillStyle = gradient;
                        context.beginPath();
                        if (typeof context.roundRect === 'function') {
                            context.roundRect(legendX, barY, legendW, 24, 12);
                        } else {
                            context.rect(legendX, barY, legendW, 24);
                        }
                        context.fill();
                    }
                    context.strokeStyle = 'rgba(255,255,255,0.6)';
                    context.lineWidth = 2;
                    context.stroke();

                    // Ticks
                    context.fillStyle = '#eaf1ff';
                    context.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    var ticks = window.paletteTicks(currentLayer);
                    ticks.forEach(function (tick, i) {
                        var x = legendX + (ticks.length > 1 ? i / (ticks.length - 1) : 0.5) * legendW;
                        context.fillText(String(tick), x, barY + 46);
                    });
                } catch (e) {}
            }
            var occupied = [];
            // Zones protégées ajustées au millimètre (cartouche haut-gauche, logo haut-droite, légende bas)
            occupied.push({ left: 0, right: margin + bannerW + 16, top: 0, bottom: bannerY + bannerH + 16 });
            occupied.push({ left: output.width - margin - 390, right: output.width, top: 0, bottom: bannerY + bannerH + 16 });
            if (legendW > 0 && legendY > 0) {
                occupied.push({ left: legendX - 25, right: legendX + legendW + 25, top: legendY - 15, bottom: output.height });
            } else if (z500HasEmbeddedLegend && manifest && manifest.height) {
                // Légende Z500 intégrée dans l'image (bas ~104 px) → zone protégée équivalente
                var zLegTop = output.height - Math.round(104 * output.height / manifest.height);
                occupied.push({ left: 0, right: output.width, top: zLegTop, bottom: output.height });
            }

            // 🌀 CYCLONES & TYPHONS OVERLAYS dans l'export HD (Cône, trajectoires, badge et creux de pression)
            if (cyclonesVisible && activeCyclonesData && activeCyclonesData.length && manifest && manifest.bounds) {
                var exportMapRect = {
                    x: offX,
                    y: offY,
                    w: 2200.0 * hScale,
                    h: (isWorldDomain() ? 1320.0 : 1640.0) * vScale
                };
                drawCycloneOverlays(context, exportMapRect, output.width, output.height, true, occupied);
            }

            // Villes sur la carte (respecte citiesVisible et se masque automatiquement si valuesVisible est actif)
            if (citiesVisible && !valuesVisible && manifest && manifest.bounds && places && places.length) {
                try {
                    var bounds = manifest.bounds;
                    var northY = mercator(Number(bounds.north));
                    var southY = mercator(Number(bounds.south));
                    var longitudeSpan = Number(bounds.east) - Number(bounds.west);
                    var mercatorSpan = northY - southY;
                    if (longitudeSpan && mercatorSpan) {
                        var exportScale = hScale;
                        // Alignement exact sur la densité du site (vue France = métropoles régionales clés ~95k hab, max 32)
                        var popMin = exportScale < 1.35 ? 95000 : (exportScale < 2.25 ? 45000 : (exportScale < 3.5 ? 15000 : 5000));
                        var maxLabels = exportScale < 1.35 ? 32 : (exportScale < 2.25 ? 50 : 80);
                        var fontSize = exportScale < 1.35 ? 22 : 24;
                        context.font = '800 ' + fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        context.textAlign = 'center';
                        context.textBaseline = 'middle';
                        context.lineJoin = 'round';
                        context.strokeStyle = '#000000';
                        context.fillStyle = '#ffffff';
                        context.lineWidth = 4.8;

                        var drawn = 0;
                        for (var pi = 0; pi < places.length; pi += 1) {
                            var place = places[pi];
                            if (!Array.isArray(place) || place.length < 4) { continue; }
                            // Densité AROME : seules les agglomérations au-dessus du seuil (évite la foule de communes)
                            if (Number(place[1]) < popMin) { continue; }
                            var proj = projectCoords(Number(place[2]), Number(place[3]));
                            var u = proj.u;
                            var v = proj.v;
                            var sx = u * 2200 * hScale + offX;
                            var sy = v * (isWorldDomain() ? 1320.0 : 1640.0) * vScale + offY;
                            if (sx < 25 || sx > output.width - 25 || sy < 25 || sy > output.height - 25) {
                                continue;
                            }
                            var text = String(place[0]);
                            var tw = context.measureText(text).width;
                            var rect = { left: sx - tw / 2 - 6, right: sx + tw / 2 + 6, top: sy - 14, bottom: sy + 14 };
                            var clash = false;
                            for (var oi = 0; oi < occupied.length; oi += 1) {
                                var other = occupied[oi];
                                if (rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top) {
                                    clash = true;
                                    break;
                                }
                            }
                            if (clash) { continue; }
                            occupied.push(rect);
                            context.strokeText(text, sx, sy);
                            context.fillText(text, sx, sy);
                            drawn += 1;
                            if (drawn >= maxLabels) { break; }
                        }
                    }
                } catch (e) {}
            }

            // Grille de valeurs numériques (si valuesVisible activé)
            if (valuesVisible && manifest && manifest.layers && manifest.layers[currentLayer]) {
                try {
                    var vLayer = manifest.layers[currentLayer];
                    var stepGrid = hScale < 1.35 ? 88 : (hScale < 2.5 ? 78 : 66);
                    var valFontSize = hScale < 1.35 ? 30 : 32;
                    context.font = '900 ' + valFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    context.textAlign = 'center';
                    context.textBaseline = 'middle';
                    context.lineJoin = 'round';

                    // Sampler couleur local (fallback si pas de probe HKV)
                    var localSampler = samplerContext;
                    if (customImage && customImage.complete && customImage.naturalWidth) {
                        var tempS = document.createElement('canvas');
                        tempS.width = customImage.naturalWidth || 2200;
                        tempS.height = customImage.naturalHeight || 1640;
                        var tempCtx = tempS.getContext('2d', { willReadFrequently: true });
                        tempCtx.drawImage(customImage, 0, 0);
                        localSampler = tempCtx;
                    }

                    for (var gy = stepGrid / 2; gy < output.height - 20; gy += stepGrid) {
                        var natH_val = isWorldDomain() ? 1320.0 : 1640.0;
                        var gv = (gy - offY) / (natH_val * vScale);
                        if (gv < 0 || gv > 1) continue;
                        for (var gx = stepGrid / 2; gx < output.width - 20; gx += stepGrid) {
                            var gu = (gx - offX) / (2200 * hScale);
                            if (gu < 0 || gu > 1) continue;

                            if (!isLand(gu, gv)) continue;

                            var gRect = { left: gx - 20, right: gx + 20, top: gy - 16, bottom: gy + 16 };
                            var gClash = false;
                            for (var oi = 0; oi < occupied.length; oi += 1) {
                                var o = occupied[oi];
                                if (gRect.left < o.right && gRect.right > o.left && gRect.top < o.bottom && gRect.bottom > o.top) {
                                    gClash = true;
                                    break;
                                }
                            }
                            if (gClash) continue;

                            // Priorité 1 : probe HKV (même logique que drawValues à l'écran)
                            var gVal = sampleProbe(currentProbe, gu, gv);
                            // Priorité 2 : décodage couleur depuis le canvas pixel
                            if (gVal === null && localSampler) {
                                var px = Math.min(Math.max(0, Math.round(gu * (localSampler.canvas.width - 1))), localSampler.canvas.width - 1);
                                var py = Math.min(Math.max(0, Math.round(gv * (localSampler.canvas.height - 1))), localSampler.canvas.height - 1);
                                var pix = localSampler.getImageData(px, py, 1, 1).data;
                                if (pix[3] >= 12) {
                                    gVal = valueFromColour(pix[0], pix[1], pix[2], vLayer);
                                }
                            }
                            if (gVal === null || !Number.isFinite(gVal)) continue;

                            if ((currentLayer === 'pluie_1h' || currentLayer === 'pluie_cumul' || currentLayer === 'neige' || currentLayer === 'equivalent_eau_neige') && gVal < 0.2) continue;
                            if (currentLayer === 'mucape' && gVal < 40) continue;
                            if (currentLayer === 'graupel' && gVal < 0.1) continue;

                            var gStr = (currentLayer === 'pluie_1h' || currentLayer === 'pluie_cumul') ? (gVal < 10 ? gVal.toFixed(1) : String(Math.round(gVal))) : String(Math.round(gVal));

                            context.strokeStyle = '#000000';
                            context.lineWidth = 6.4;
                            context.strokeText(gStr, gx, gy);
                            context.fillStyle = getValueColour(gVal, currentLayer);
                            context.fillText(gStr, gx, gy);
                        }
                    }
                } catch (vErr) {}
            }


            return output;
        }

        function captureImage(format, isLandscape) {
            format = format || 'png';
            var canvas = composeCaptureCanvas(null, null, isLandscape);
            if (!canvas || !canvas.toBlob) {
                setToolHint('Capture indisponible pour ce navigateur.');
                return;
            }
            var mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
            var ext = format === 'jpeg' ? 'jpg' : 'png';
            canvas.toBlob(function (blob) {
                if (!blob) {
                    return;
                }
                var url = URL.createObjectURL(blob);
                var link = document.createElement('a');
                var layerLabel = manifest && manifest.layers && manifest.layers[currentLayer]
                    ? manifest.layers[currentLayer].label
                    : currentLayer;
                var slug = String(layerLabel || 'arome').toLowerCase()
                    .normalize('NFD').replace(/[̀-ͯ]/g, '')
                    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                link.href = url;
                link.download = ((document.getElementById('amfm-logo-navbar') && document.getElementById('amfm-logo-navbar').src.indexOf('mm') !== -1) ? 'MonsieurMeteo_' : 'MeteoClimatPro_') + (manifest ? manifest.model_name.replace(/[^a-zA-Z0-9]/g, '_') : 'AROME') + '_' + (slug || 'carte') + (isLandscape ? '_paysage_16x9' : '') + '_' + Date.now() + '.' + ext;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            }, mimeType, format === 'jpeg' ? 0.92 : undefined);
        }

        // ────────────────────────────────────────────────────────────────────
        // EXPORT GIF ANIMÉ PROFESSIONNEL (avec modal & sélection d'échéances)
        // ────────────────────────────────────────────────────────────────────
        var gifModal = app.querySelector('[data-amfm-gif-modal]');
        var gifModalClose = app.querySelector('[data-amfm-gif-close]');
        var gifCustomRangeDiv = app.querySelector('[data-amfm-gif-custom-range]');
        var gifStartSelect = app.querySelector('[data-amfm-gif-start]');
        var gifEndSelect = app.querySelector('[data-amfm-gif-end]');
        var gifProgressBox = app.querySelector('[data-amfm-gif-progress-box]');
        var gifPercentText = app.querySelector('[data-amfm-gif-percent]');
        var gifProgressBar = app.querySelector('[data-amfm-gif-bar]');
        var gifStatusText = app.querySelector('[data-amfm-gif-status-text]');
        var gifSubmitBtn = app.querySelector('[data-amfm-gif-submit]');

        function openGifModal(requestedFraming) {
            var steps = availableSteps();
            if (!steps.length) {
                showError('Aucune échéance disponible pour le GIF.');
                return;
            }
            if (gifModal) {
                var framingToSelect = requestedFraming;
                if (!framingToSelect) {
                    framingToSelect = (transform && transform.scale > 1.08) ? 'screen' : 'full';
                }
                var framingRadio = gifModal.querySelector('input[name="gif-framing"][value="' + framingToSelect + '"]');
                if (framingRadio) framingRadio.checked = true;
                // Remplir les sélecteurs de plage personnalisée
                if (gifStartSelect && gifEndSelect) {
                    gifStartSelect.innerHTML = '';
                    gifEndSelect.innerHTML = '';
                    steps.forEach(function (step, i) {
                        var opt1 = document.createElement('option');
                        opt1.value = String(i);
                        opt1.textContent = 'H+' + String(step.lead_hour).padStart(2, '0');
                        gifStartSelect.appendChild(opt1);

                        var opt2 = document.createElement('option');
                        opt2.value = String(i);
                        opt2.textContent = 'H+' + String(step.lead_hour).padStart(2, '0');
                        if (i === steps.length - 1) opt2.selected = true;
                        gifEndSelect.appendChild(opt2);
                    });
                }
                if (gifProgressBox) gifProgressBox.style.display = 'none';
                if (gifSubmitBtn) {
                    gifSubmitBtn.disabled = false;
                    gifSubmitBtn.innerHTML = '<i class="fa-solid fa-download"></i> Lancer la Génération GIF';
                }
                gifModal.hidden = false;
            } else {
                startGifGeneration();
            }
        }

        if (gifModalClose) {
            gifModalClose.addEventListener('click', function () {
                if (gifModal) gifModal.hidden = true;
            });
        }
        if (gifModal) {
            gifModal.addEventListener('click', function (e) {
                if (e.target === gifModal) gifModal.hidden = true;
            });
            var rangeRadios = gifModal.querySelectorAll('input[name="gif-range"]');
            rangeRadios.forEach(function (radio) {
                radio.addEventListener('change', function () {
                    if (gifCustomRangeDiv) {
                        gifCustomRangeDiv.style.display = (radio.value === 'custom') ? 'flex' : 'none';
                    }
                });
            });
        }
        if (gifSubmitBtn) {
            gifSubmitBtn.addEventListener('click', function () {
                startGifGeneration();
            });
        }

        function startGifGeneration() {
            var allSteps = availableSteps();
            if (!allSteps.length) return;
            if (typeof window.GIF !== 'function') {
                showError('Bibliothèque gif.js non chargée.');
                return;
            }

            // Déterminer le cadrage choisi (Carte Complète ou Écran)
            var isScreen = false;
            var checkedFraming = gifModal ? gifModal.querySelector('input[name="gif-framing"]:checked') : null;
            if (checkedFraming) {
                isScreen = (checkedFraming.value === 'screen');
            }

            // Déterminer la plage d'échéances choisie
            var selectedRange = 'all';
            var checkedRange = gifModal ? gifModal.querySelector('input[name="gif-range"]:checked') : null;
            if (checkedRange) selectedRange = checkedRange.value;

            var filteredSteps = allSteps;
            if (selectedRange === '24h') {
                filteredSteps = allSteps.filter(function (s) { return Number(s.lead_hour) <= 24; });
            } else if (selectedRange === '48h') {
                filteredSteps = allSteps.filter(function (s) { return Number(s.lead_hour) <= 48; });
            } else if (selectedRange === 'custom') {
                var startIdx = gifStartSelect ? parseInt(gifStartSelect.value, 10) : 0;
                var endIdx = gifEndSelect ? parseInt(gifEndSelect.value, 10) : allSteps.length - 1;
                if (startIdx > endIdx) { var tmp = startIdx; startIdx = endIdx; endIdx = tmp; }
                filteredSteps = allSteps.slice(startIdx, endIdx + 1);
            }
            if (!filteredSteps.length) filteredSteps = allSteps;

            // Déterminer la vitesse
            var frameDelay = 1000;
            var checkedSpeed = gifModal ? gifModal.querySelector('input[name="gif-speed"]:checked') : null;
            if (checkedSpeed) frameDelay = parseInt(checkedSpeed.value, 10) || 1000;

            // Interface de progression
            if (gifProgressBox) gifProgressBox.style.display = 'block';
            if (gifSubmitBtn) {
                gifSubmitBtn.disabled = true;
                gifSubmitBtn.innerHTML = '<i class="fa-solid fa-hourglass-half fa-spin"></i> Génération en cours…';
            }
            [captureGifButton, captureGifScreenButton].forEach(function (btn) {
                if (!btn) return;
                btn.classList.add('is-loading');
                btn.innerHTML = '<i class="fa-solid fa-hourglass-half fa-spin"></i> <span>0%</span>';
            });

            // Dimensions GIF : ratio adapté selon Carte Complète (880 × 656) ou Cadrage Écran
            var gw = 880;
            var gh = 656;

            if (isScreen && viewport) {
                var vw = viewport.clientWidth || 960;
                var vh = viewport.clientHeight || 540;
                var maxDim = 960;
                if (vw >= vh) {
                    gw = maxDim;
                    gh = Math.round(maxDim * (vh / vw));
                } else {
                    gh = maxDim;
                    gw = Math.round(maxDim * (vw / vh));
                }
                if (gw % 2 !== 0) gw += 1;
                if (gh % 2 !== 0) gh += 1;
            }

            var workerAbsoluteUrl = new URL('js/gif.worker.js', window.location.href).href;
            var gifOptions = {
                quality: 10,
                width: gw,
                height: gh,
                workers: 2,
                workerScript: workerAbsoluteUrl
            };
            var gif = new window.GIF(gifOptions);
            var index = 0;

            function next() {
                if (index >= filteredSteps.length) {
                    if (gifStatusText) gifStatusText.innerHTML = '<i class="fa-solid fa-hourglass-half fa-spin"></i> Finalisation du fichier GIF…';
                    try {
                        gif.render();
                    } catch (renderErr) {
                        console.error('Erreur render GIF:', renderErr);
                        if (captureGifButton) {
                            captureGifButton.classList.remove('is-loading');
                            captureGifButton.innerHTML = '<i class="fa-solid fa-film"></i> <span>GIF</span>';
                        }
                        if (gifSubmitBtn) gifSubmitBtn.disabled = false;
                    }
                    return;
                }
                var step = filteredSteps[index];
                var img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () {
                    var fullCanvas = composeCaptureCanvas(step, img, isScreen);
                    if (fullCanvas) {
                        var gifCanvas = document.createElement('canvas');
                        gifCanvas.width = gw;
                        gifCanvas.height = gh;
                        var gctx = gifCanvas.getContext('2d');
                        gctx.drawImage(fullCanvas, 0, 0, gw, gh);
                        gif.addFrame(gifCanvas, { copy: true, delay: frameDelay });
                    }
                    index += 1;
                    var pct = Math.round((index / filteredSteps.length) * 50);
                    if (gifProgressBar) gifProgressBar.style.width = pct + '%';
                    if (gifPercentText) gifPercentText.textContent = pct + '%';
                    [captureGifButton, captureGifScreenButton].forEach(function (btn) {
                        if (btn) btn.innerHTML = '<i class="fa-solid fa-hourglass-half fa-spin"></i> <span>' + pct + '%</span>';
                    });
                    next();
                };
                img.onerror = function () {
                    index += 1;
                    next();
                };
                img.src = versioned(step.files[currentLayer]);
            }

            var layer = manifest && manifest.layers && manifest.layers[currentLayer];

            gif.on('progress', function (p) {
                var pct = 50 + Math.round(p * 50);
                if (gifProgressBar) gifProgressBar.style.width = pct + '%';
                if (gifPercentText) gifPercentText.textContent = pct + '%';
                if (captureGifButton) {
                    captureGifButton.innerHTML = '<i class="fa-solid fa-hourglass-half fa-spin"></i> <span>' + pct + '%</span>';
                }
            });
            gif.on('finished', function (blob) {
                try {
                    var currentLayerObj = manifest && manifest.layers && manifest.layers[currentLayer];
                    var slug = String(currentLayerObj ? currentLayerObj.label : 'animation').toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    var modelName = (manifest && manifest.model_name) ? manifest.model_name.replace(/[^a-zA-Z0-9]/g, '_') : 'AROME';
                    var prefix = (document.getElementById('amfm-logo-navbar') && document.getElementById('amfm-logo-navbar').src.indexOf('mm') !== -1) ? 'MonsieurMeteo_' : 'MeteoClimatPro_';
                    var filename = prefix + modelName + '_' + (slug || 'animation') + (isScreen ? '_ecran_' : '_') + Date.now() + '.gif';

                    var url = URL.createObjectURL(blob);
                    var link = document.createElement('a');
                    link.href = url;
                    link.download = filename;
                    link.rel = 'noopener';
                    document.body.appendChild(link);
                    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    window.setTimeout(function () {
                        if (link.parentNode) {
                            link.parentNode.removeChild(link);
                        }
                        URL.revokeObjectURL(url);
                    }, 2000);
                } catch (finishErr) {
                    console.error('Erreur déclenchement téléchargement GIF:', finishErr);
                }

                if (gifModal) gifModal.hidden = true;
                if (gifProgressBox) gifProgressBox.style.display = 'none';
                if (gifSubmitBtn) {
                    gifSubmitBtn.disabled = false;
                    gifSubmitBtn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger le GIF';
                }
                if (captureGifButton) {
                    captureGifButton.classList.remove('is-loading');
                    captureGifButton.innerHTML = '<i class="fa-solid fa-film"></i> <span>GIF</span>';
                }
                if (captureGifScreenButton) {
                    captureGifScreenButton.classList.remove('is-loading');
                    captureGifScreenButton.innerHTML = '<i class="fa-solid fa-video"></i> <span>GIF Écran</span>';
                }
                setToolHint('GIF généré et téléchargé avec succès !');
            });
            if (typeof gif.on === 'function') {
                gif.on('abort', function () {
                    if (captureGifButton) {
                        captureGifButton.classList.remove('is-loading');
                        captureGifButton.innerHTML = '<i class="fa-solid fa-film"></i> <span>GIF</span>';
                    }
                    if (captureGifScreenButton) {
                        captureGifScreenButton.classList.remove('is-loading');
                        captureGifScreenButton.innerHTML = '<i class="fa-solid fa-video"></i> <span>GIF Écran</span>';
                    }
                    setToolHint('Génération du GIF interrompue.');
                });
            }
            next();
        }

        // ────────────────────────────────────────────────────────────────────
        // EXPORT PACK TIKTOK 12 CARTES (J0 à J11, 1080×1920, Fond transparent)
        // ────────────────────────────────────────────────────────────────────
        var tiktokAssets = null;
        function loadTiktokAssets() {
            if (tiktokAssets && tiktokAssets.mask && tiktokAssets.mask.complete && tiktokAssets.mask.naturalWidth &&
                tiktokAssets.white && tiktokAssets.white.complete && tiktokAssets.white.naturalWidth &&
                tiktokAssets.borders && tiktokAssets.borders.complete && tiktokAssets.borders.naturalWidth) {
                return Promise.resolve(tiktokAssets);
            }
            function loadImg(relPath) {
                return new Promise(function(resolve) {
                    var img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = function() { resolve(img); };
                    img.onerror = function(e) { console.error('Erreur chargement ' + relPath, e); resolve(null); };
                    var absUrl = new URL(relPath, window.location.href).href;
                    img.src = absUrl + (absUrl.indexOf('?') === -1 ? '?' : '&') + 'v=' + Date.now();
                });
            }
            return Promise.all([
                loadImg('config/mask_france_exact.png'),
                loadImg('config/white_france_tiktok.png'),
                loadImg('config/borders_france_tiktok.png')
            ]).then(function(results) {
                if (!results[0] || !results[1] || !results[2]) return null;
                tiktokAssets = {
                    mask: results[0],
                    white: results[1],
                    borders: results[2]
                };
                return tiktokAssets;
            });
        }

        function getTiktokSteps(layerKey) {
            var all = availableSteps();
            if (!all || !all.length) return [];

            // Si toutes les étapes pour ce layer sont déjà espacées d'environ 24h
            // (ex: temperature_max_24h, temperature_min_24h où il y a ~17 étapes au total : J0 à J16)
            if (all.length <= 20) {
                return all.slice(0, 16);
            }

            // Sinon (ex: pluie_cumul, temperature, vent avec pas de 3h ou 6h) :
            // Regroupons les étapes par jour civil (valid_time ou lead_hour / 24)
            var daysMap = {};
            var dayKeys = [];
            all.forEach(function(s) {
                var dateStr = (s.valid_time || '').slice(0, 10);
                if (!dateStr) {
                    dateStr = 'day_' + Math.floor(s.lead_hour / 24);
                }
                if (!daysMap[dateStr]) {
                    daysMap[dateStr] = [];
                    dayKeys.push(dateStr);
                }
                daysMap[dateStr].push(s);
            });

            var selected = [];
            dayKeys.slice(0, 16).forEach(function(dKey) {
                var daySteps = daysMap[dKey];
                if (!daySteps || !daySteps.length) return;

                var chosen = daySteps[0];
                if (layerKey && layerKey.indexOf('cumul') !== -1) {
                    // Pour les cumuls de pluie sur 24h, prendre l'échéance terminale du jour
                    chosen = daySteps[daySteps.length - 1];
                } else {
                    // Pour les autres paramètres (températures instantanées, vent, rafales),
                    // choisir l'heure la plus proche de 14h UTC
                    var bestDiff = 999;
                    daySteps.forEach(function(s) {
                        var h = 12;
                        if (s.valid_time) {
                            var d = new Date(s.valid_time);
                            h = d.getUTCHours();
                        } else {
                            h = s.lead_hour % 24;
                        }
                        var diff = Math.abs(h - 14);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            chosen = s;
                        }
                    });
                }
                selected.push(chosen);
            });

            return selected.length >= 5 ? selected.slice(0, 16) : all.slice(0, 16);
        }

        var isTiktokGenerating = false;
        function downloadTiktokPack() {
            if (isTiktokGenerating) return;
            if (typeof window.JSZip !== 'function') {
                setToolHint('Module de compression ZIP en cours de chargement…');
                return;
            }

            var steps = getTiktokSteps(currentLayer);
            if (!steps || !steps.length) {
                setToolHint('Aucune échéance disponible pour le pack TikTok.');
                return;
            }

            isTiktokGenerating = true;
            var origBtnHtml = captureTiktokButton ? captureTiktokButton.innerHTML : '';
            if (captureTiktokButton) {
                captureTiktokButton.classList.add('is-loading');
                captureTiktokButton.disabled = true;
                captureTiktokButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>0/' + steps.length + '</span>';
            }

            function resetBtn() {
                isTiktokGenerating = false;
                if (captureTiktokButton) {
                    captureTiktokButton.classList.remove('is-loading');
                    captureTiktokButton.disabled = false;
                    captureTiktokButton.innerHTML = origBtnHtml;
                }
            }

            loadTiktokAssets().then(function(assets) {
                if (!assets) {
                    setToolHint('Erreur : Ressources cartographiques TikTok introuvables.');
                    resetBtn();
                    return;
                }

                var zip = new window.JSZip();
                var index = 0;

                function processNext() {
                    if (index >= steps.length) {
                        if (captureTiktokButton) {
                            captureTiktokButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>ZIP…</span>';
                        }
                        var layerSlug = (manifest && manifest.layers && manifest.layers[currentLayer] ? manifest.layers[currentLayer].label : currentLayer)
                            .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                        var zipName = 'pack-tiktok-' + (layerSlug || 'meteo') + '-16j.zip';
                        zip.generateAsync({ type: 'blob' }).then(function(blob) {
                            var url = URL.createObjectURL(blob);
                            var link = document.createElement('a');
                            link.href = url;
                            link.download = zipName;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
                            resetBtn();
                            setToolHint('Pack TikTok 16 cartes (J0 à J15) téléchargé avec succès !');
                        }).catch(function(err) {
                            console.error('Erreur génération ZIP:', err);
                            resetBtn();
                        });
                        return;
                    }

                    var step = steps[index];
                    var stepNum = index + 1;
                    if (captureTiktokButton) {
                        captureTiktokButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>' + stepNum + '/' + steps.length + '</span>';
                    }

                    var fileUrl = step.files && step.files[currentLayer];
                    if (!fileUrl) {
                        index += 1;
                        processNext();
                        return;
                    }

                    var img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = function() {
                        // 1. Offscreen canvas 2200 × 1640 pour le calque météo masqué
                        var rawCanvas = document.createElement('canvas');
                        rawCanvas.width = 2200;
                        rawCanvas.height = 1640;
                        var rawCtx = rawCanvas.getContext('2d');

                        // Dessin du calque météo
                        rawCtx.drawImage(img, 0, 0, 2200, 1640);

                        // Masquage strict terre France + Corse (mer et étranger transparents)
                        rawCtx.globalCompositeOperation = 'destination-in';
                        rawCtx.drawImage(assets.mask, 0, 0, 2200, 1640);
                        rawCtx.globalCompositeOperation = 'source-over';

                        // Découpage et décalage de la Corse : dx = -150, dy = 0
                        var csx = 1685, csy = 1215, csw = 135, csh = 230;
                        var corseCanvas = document.createElement('canvas');
                        corseCanvas.width = csw;
                        corseCanvas.height = csh;
                        corseCanvas.getContext('2d').drawImage(rawCanvas, csx, csy, csw, csh, 0, 0, csw, csh);
                        rawCtx.clearRect(csx, csy, csw, csh);
                        rawCtx.drawImage(corseCanvas, csx - 150, csy);

                        // 2. Canevas d'assemblage 2200 × 1640
                        var composeCanvas = document.createElement('canvas');
                        composeCanvas.width = 2200;
                        composeCanvas.height = 1640;
                        var compCtx = composeCanvas.getContext('2d');

                        // Fond blanc sous la France pour éviter les zones noires si 0 mm de pluie / donnée absente
                        compCtx.drawImage(assets.white, 0, 0, 2200, 1640);

                        // Dessin du calque météo par-dessus le fond blanc
                        compCtx.drawImage(rawCanvas, 0, 0, 2200, 1640);

                        // Frontières départementales vectorielles nettes
                        compCtx.drawImage(assets.borders, 0, 0, 2200, 1640);

                        // 3. Cadrage et centrage sur canevas TikTok 1080 × 1920 vertical
                        var ttCanvas = document.createElement('canvas');
                        ttCanvas.width = 1080;
                        ttCanvas.height = 1920;
                        var ttCtx = ttCanvas.getContext('2d');
                        ttCtx.clearRect(0, 0, 1080, 1920);

                        var cropX = 310, cropY = 173, cropW = 1395, cropH = 1282;
                        var targetW = 1040;
                        var targetH = Math.round(targetW * (cropH / cropW));
                        var targetX = Math.round((1080 - targetW) / 2);
                        var targetY = Math.round((1920 - targetH) / 2);

                        ttCtx.drawImage(composeCanvas, cropX, cropY, cropW, cropH, targetX, targetY, targetW, targetH);

                        var dateStr = '';
                        if (step.valid_time) {
                            dateStr = step.valid_time.slice(0, 10);
                        }
                        var numPrefix = (index + 1 < 10 ? '0' + (index + 1) : '' + (index + 1));
                        var leadTag = 'J+' + index;
                        var fileName = numPrefix + '_carte-meteo-' + (currentLayer || 'param') + '-' + leadTag + (dateStr ? '_' + dateStr : '') + '.png';

                        ttCanvas.toBlob(function(blob) {
                            if (blob) {
                                zip.file(fileName, blob);
                            }
                            index += 1;
                            processNext();
                        }, 'image/png');
                    };
                    img.onerror = function() {
                        console.warn('Erreur chargement étape TikTok:', step);
                        index += 1;
                        processNext();
                    };
                    img.src = versioned(fileUrl);
                }

                processNext();
            });
        }

        function closeDiagram() {
            if (diagramPopup) {
                diagramPopup.hidden = true;
            }
            diagramLoadToken += 1;
        }

        function fetchDepartmentForDiagram(code) {
            if (departmentCache.has(code)) {
                return departmentCache.get(code);
            }
            var promise = fetchJson(baseUrl + '/departements/' + code + '.json')
                .catch(function (error) {
                    departmentCache.delete(code);
                    throw error;
                });
            departmentCache.set(code, promise);
            return promise;
        }

        function positionDiagramPopup(clientX, clientY) {
            if (!diagramPopup) {
                return;
            }
            var box = viewport.getBoundingClientRect();
            var left = clientX - box.left + 14;
            var top = clientY - box.top + 14;
            var width = diagramPopup.offsetWidth || 320;
            var height = diagramPopup.offsetHeight || 220;
            if (left + width > box.width - 8) {
                left = clientX - box.left - width - 14;
            }
            if (top + height > box.height - 8) {
                top = clientY - box.top - height - 14;
            }
            diagramPopup.style.left = Math.max(8, left) + 'px';
            diagramPopup.style.top = Math.max(8, top) + 'px';
        }

        function renderDiagramChart(name, forecastRows, columnIndex, pointIndex) {
            if (!diagramBody) {
                return;
            }
            diagramBody.replaceChildren();
            var temperatures = [];
            var rains = [];
            var hourLabels = [];
            forecastRows.slice(0, 30).forEach(function (row) {
                var values = row[1] && row[1][pointIndex];
                if (!values) {
                    return;
                }
                var date = new Date(row[0]);
                var tempIndex = columnIndex.temperature_c;
                var rainIndex = columnIndex.precipitation_mm;
                temperatures.push(typeof tempIndex === 'number' ? Number(values[tempIndex]) : null);
                rains.push(typeof rainIndex === 'number' ? Number(values[rainIndex]) : 0);
                hourLabels.push(String(date.getHours()).padStart(2, '0') + 'h');
            });
            var validTemps = temperatures.filter(function (value) { return Number.isFinite(value); });
            if (!validTemps.length) {
                diagramBody.appendChild(document.createTextNode('Aucune donnée exploitable pour ce point.'));
                return;
            }
            var width = 320;
            var height = 150;
            var margin = { left: 30, right: 10, top: 14, bottom: 20 };
            var innerWidth = width - margin.left - margin.right;
            var innerHeight = height - margin.top - margin.bottom;
            var minTemp = Math.min.apply(null, validTemps);
            var maxTemp = Math.max.apply(null, validTemps);
            if (minTemp === maxTemp) {
                minTemp -= 1;
                maxTemp += 1;
            }
            var maxRain = Math.max(1, Math.max.apply(null, rains.map(function (value) {
                return Number.isFinite(value) ? value : 0;
            })));
            var svgNs = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(svgNs, 'svg');
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            svg.setAttribute('class', 'amfm-diagram-svg');
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', 'Diagramme AROME pour ' + name);
            var count = temperatures.length;
            var stepX = count > 1 ? innerWidth / (count - 1) : 0;

            rains.forEach(function (value, index) {
                if (!Number.isFinite(value) || value <= 0) {
                    return;
                }
                var barHeight = value / maxRain * innerHeight * 0.55;
                var rect = document.createElementNS(svgNs, 'rect');
                rect.setAttribute('x', (margin.left + index * stepX - stepX * 0.3).toFixed(1));
                rect.setAttribute('y', (margin.top + innerHeight - barHeight).toFixed(1));
                rect.setAttribute('width', Math.max(1.5, stepX * 0.6).toFixed(1));
                rect.setAttribute('height', barHeight.toFixed(1));
                rect.setAttribute('class', 'amfm-diagram-rain');
                svg.appendChild(rect);
            });

            var points = temperatures.map(function (value, index) {
                if (!Number.isFinite(value)) {
                    return null;
                }
                var x = margin.left + index * stepX;
                var y = margin.top + innerHeight * (maxTemp - value) / (maxTemp - minTemp);
                return x.toFixed(1) + ',' + y.toFixed(1);
            }).filter(Boolean);
            if (points.length > 1) {
                var polyline = document.createElementNS(svgNs, 'polyline');
                polyline.setAttribute('points', points.join(' '));
                polyline.setAttribute('class', 'amfm-diagram-temp');
                svg.appendChild(polyline);
            }

            [0, count - 1].forEach(function (index) {
                if (index < 0 || !hourLabels[index]) {
                    return;
                }
                var text = document.createElementNS(svgNs, 'text');
                text.setAttribute('x', (margin.left + index * stepX).toFixed(1));
                text.setAttribute('y', (height - 5).toFixed(1));
                text.setAttribute('text-anchor', index === 0 ? 'start' : 'end');
                text.setAttribute('class', 'amfm-diagram-axis');
                text.textContent = hourLabels[index];
                svg.appendChild(text);
            });

            [minTemp, maxTemp].forEach(function (value) {
                var y = margin.top + innerHeight * (maxTemp - value) / (maxTemp - minTemp);
                var text = document.createElementNS(svgNs, 'text');
                text.setAttribute('x', (margin.left - 4).toFixed(1));
                text.setAttribute('y', (y + 3).toFixed(1));
                text.setAttribute('text-anchor', 'end');
                text.setAttribute('class', 'amfm-diagram-axis');
                text.textContent = Math.round(value) + '°';
                svg.appendChild(text);
            });

            diagramBody.appendChild(svg);
            var caption = document.createElement('p');
            caption.className = 'amfm-diagram-caption';
            caption.textContent = 'Température (ligne) et précipitations horaires (barres) — prochaines échéances AROME.';
            diagramBody.appendChild(caption);
        }

        function openDiagramAt(clientX, clientY) {
            var point = screenToLatLon(clientX, clientY);
            if (!point || !diagramPopup) {
                return;
            }
            var place = nearestPlace(point.latitude, point.longitude);
            if (!place || place.length < 6) {
                setToolHint('Aucune commune identifiée à cet endroit — essayez un point plus proche d’une ville.');
                return;
            }
            setToolHint('Cliquez sur la carte pour afficher le diagramme AROME du point choisi.');
            var name = String(place[0]);
            var communeCode = String(place[4]);
            var departmentCode = String(place[5]);
            var token = ++diagramLoadToken;
            diagramTitle.textContent = name;
            diagramPopup.hidden = false;
            diagramBody.replaceChildren();
            if (diagramStatus) {
                diagramStatus.hidden = false;
                diagramStatus.textContent = 'Chargement du diagramme…';
                diagramBody.appendChild(diagramStatus);
            }
            positionDiagramPopup(clientX, clientY);
            fetchDepartmentForDiagram(departmentCode)
                .then(function (departmentData) {
                    if (token !== diagramLoadToken) {
                        return;
                    }
                    var communes = departmentData.communes || [];
                    var commune = null;
                    for (var index = 0; index < communes.length; index += 1) {
                        if (String(communes[index][0]) === communeCode) {
                            commune = communes[index];
                            break;
                        }
                    }
                    if (!commune) {
                        diagramBody.replaceChildren(document.createTextNode('Commune introuvable dans les données du département.'));
                        return;
                    }
                    var columns = departmentData.columns && Array.isArray(departmentData.columns.values)
                        ? departmentData.columns.values
                        : [];
                    var columnIndex = {};
                    columns.forEach(function (columnName, columnPosition) {
                        columnIndex[columnName] = columnPosition;
                    });
                    var pointIndex = Number(commune[6]);
                    var lowerTime = Date.now() - 3600000;
                    var forecastRows = (departmentData.forecast || []).filter(function (step) {
                        return Array.isArray(step) && new Date(step[0]).getTime() >= lowerTime;
                    });
                    renderDiagramChart(name, forecastRows, columnIndex, pointIndex);
                    positionDiagramPopup(clientX, clientY);
                })
                .catch(function () {
                    if (token !== diagramLoadToken) {
                        return;
                    }
                    diagramBody.replaceChildren(document.createTextNode('Impossible de charger ce diagramme pour le moment.'));
                });
        }

        function showUnavailable(message) {
            if (unavailableBox) {
                if (unavailableText) {
                    unavailableText.textContent = message || 'Paramètre non disponible pour ce modèle';
                }
                unavailableBox.hidden = false;
            }
            if (legend) legend.hidden = true;
            hideProbe();
        }

        function clearUnavailable() {
            if (unavailableBox) {
                unavailableBox.hidden = true;
            }
        }

        function availableSteps() {
            if (!manifest || !Array.isArray(manifest.steps)) {
                return [];
            }
            return manifest.steps.filter(function (step) {
                if (!step || Number(step.lead_hour) < 0) return false;
                // ponytail: lead 0 pour la pluie est physiquement à 0 mm (carte 100% transparente) ; débuter dès la 1ère échéance active
                if ((currentLayer === 'pluie_1h' || currentLayer === 'pluie_cumul') && Number(step.lead_hour) === 0) {
                    return false;
                }
                if (currentLayer && step.files) {
                    return !!step.files[currentLayer];
                }
                return true;
            });
        }

        function initialStep(steps) {
            var threshold = Date.now() - 60 * 60 * 1000;
            for (var index = 0; index < steps.length; index += 1) {
                if (new Date(steps[index].valid_time).getTime() >= threshold) {
                    return index;
                }
            }
            return 0;
        }

        function setMenuOpen(open) {
            layerMenu.hidden = !open;
            menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            app.classList.toggle('is-layer-menu-open', open);
        }

        function refreshLayerMenu() {
            if (!manifest || !manifest.layers) return;
            var current = manifest.layers[currentLayer];
            if (currentLayerText) {
                currentLayerText.textContent = current ? current.label : 'Choisir une carte';
            }
            if (layerGrid) {
                layerGrid.querySelectorAll('[data-amfm-layer-key]').forEach(function (button) {
                    var active = button.dataset.amfmLayerKey === currentLayer;
                    button.classList.toggle('is-active', active);
                    button.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
            }
        }

        function buildLayerMenu() {
            if (!layerGrid || !manifest || !manifest.layers) return;
            var groupOrder = [
                'Températures',
                'Précipitations',
                'Vent',
                'Mer & Vagues',
                'Nuages et humidité',
                'Pression et géopotentiel',
                'Instabilité',
                'Relief',
                'Autres'
            ];
            var grouped = {};
            if (typeof layerGrid.replaceChildren === 'function') {
                layerGrid.replaceChildren();
            } else {
                layerGrid.innerHTML = '';
            }
            Object.keys(manifest.layers || {}).forEach(function (key) {
                // Les variantes de style (ex: geopotentiel_500_meteociel) sont pilotées
                // par le sélecteur de style, pas par le menu des couches
                if (key.indexOf('_meteociel') !== -1) { return; }
                if (currentModel === 'arpege' && (key === 'temperature' || key === 'temperature_ressentie' || key === 'point_rosee' || key === 'humidex' || key === 'temperature_min_24h' || key === 'temperature_max_24h')) {
                    return; // Masqué pour ARPEGE Europe (seule la T850 hPa est conservée)
                }
                var layer = manifest.layers[key];
                var group = layer.group || 'Autres';
                if (!grouped[group]) {
                    grouped[group] = [];
                }
                grouped[group].push({ key: key, layer: layer });
            });
            if (!manifest.layers[currentLayer]) {
                currentLayer = Object.keys(manifest.layers || {})[0] || '';
            }
            // S'assurer que tout groupe présent dans grouped est bien inclus
            Object.keys(grouped).forEach(function (g) {
                if (groupOrder.indexOf(g) === -1) {
                    groupOrder.push(g);
                }
            });
            groupOrder.forEach(function (group) {
                if (!grouped[group] || !grouped[group].length) {
                    return;
                }
                var section = document.createElement('section');
                section.className = 'amfm-layer-group';
                var title = document.createElement('h3');
                title.textContent = group;
                section.appendChild(title);
                grouped[group].forEach(function (entry) {
                    var button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'amfm-layer-option';
                    button.dataset.amfmLayerKey = entry.key;
                    button.setAttribute('aria-pressed', 'false');
                    var label = document.createElement('span');
                    label.textContent = entry.layer.label || entry.key;
                    var dot = document.createElement('i');
                    dot.setAttribute('aria-hidden', 'true');
                    button.appendChild(label);
                    button.appendChild(dot);
                    button.addEventListener('click', function () {
                        setLayer(entry.key);
                        if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
                            setMenuOpen(false);
                        }
                    });
                    section.appendChild(button);
                });
                layerGrid.appendChild(section);
            });
            refreshLayerMenu();
        }

        function applyPaletteStops() {
            if (!manifest || !manifest.layers || typeof window.getLayerPalette !== 'function') {
                return;
            }
            Object.keys(manifest.layers).forEach(function (key) {
                var layer = manifest.layers[key];
                var pal = window.getLayerPalette(key);
                if (!layer.stops || !layer.stops.length) {
                    layer.stops = pal.stops;
                }
                if (layer.transparent_below === undefined || layer.transparent_below === null) {
                    layer.transparent_below = pal.transparent_below;
                }
                if (!layer.unit && pal.unit) {
                    layer.unit = pal.unit;
                }
                if (layer.decimals === undefined || layer.decimals === null) {
                    layer.decimals = pal.decimals;
                }
                if (!layer.label && pal.label) {
                    layer.label = pal.label;
                }
            });
        }

        function buildLegend() {
            if (!legend || !manifest || !manifest.layers) return;
            var layer = manifest.layers[currentLayer];
            var labelEl = app.querySelector('[data-amfm-legend-label]');
            var unitEl = app.querySelector('[data-amfm-legend-unit]');
            var barEl = app.querySelector('[data-amfm-legend-bar]');
            var ticksEl = app.querySelector('[data-amfm-legend-ticks]');

            // Z500 : la légende (30 rectangles 492→612 dam) est INTÉGRÉE dans
            // l'image elle-même → masquer le panneau pour ne pas la recouvrir.
            var z500Embedded = (currentLayer === 'geopotentiel_500' ||
                                currentLayer === 'geopotentiel_500_meteociel');
            legend.hidden = z500Embedded;
            if (z500Embedded) {
                return;
            }

            if (labelEl && layer) labelEl.textContent = layer.label || 'Échelle';
            if (unitEl && layer) unitEl.textContent = layer.unit || '';

            if (barEl && typeof window.paletteGradientCSS === 'function') {
                barEl.style.background = window.paletteGradientCSS(currentLayer);
            }
            if (ticksEl && typeof window.paletteTicks === 'function') {
                ticksEl.innerHTML = window.paletteTicks(currentLayer).map(function (t) {
                    return '<span>' + t + '</span>';
                }).join('');
            }
        }

        function preloadNeighbour(steps, index) {
            var offsets = [-1, 1];
            if (index === steps.length - 1) offsets.push(-(steps.length - 1));
            if (index === 0) offsets.push(steps.length - 1);
            offsets.forEach(function (offset) {
                var targetIdx = (index + offset + steps.length) % steps.length;
                var neighbour = steps[targetIdx];
                if (!neighbour || !neighbour.files[currentLayer]) {
                    return;
                }
                var preload = new Image();
                preload.crossOrigin = 'anonymous';
                preload.src = versioned(neighbour.files[currentLayer]);
            });
        }

        function renderStep(index) {
            var steps = availableSteps();
            if (!steps.length) {
                showError('Aucune carte disponible pour ce paramètre.');
                return;
            }
            currentStep = clamp(index, 0, steps.length - 1);
            if (slider) {
                slider.max = String(steps.length - 1);
                slider.value = String(currentStep);
            }
            updateUrl();
            if (previousButton) previousButton.disabled = currentStep === 0;
            if (nextButton) nextButton.disabled = currentStep === steps.length - 1;

            var step = steps[currentStep];
            var date = new Date(step.valid_time);
            var is24h = (currentModel.indexOf('probabilites') !== -1) || 
                        (currentLayer.indexOf('_24h') !== -1) || 
                        (currentLayer.indexOf('prob_') === 0);
            var dayOffset = Math.floor(step.lead_hour / 24);
            var leadStr = '';
            var dateFormatted = '';

            if (is24h) {
                leadStr = (dayOffset === 0) ? "J+0 (Aujourd'hui)" :
                          (dayOffset === 1) ? "J+1 (Demain)" :
                          ('J+' + dayOffset);
                try {
                    var dOpt = { weekday: 'short', day: '2-digit', month: '2-digit' };
                    dateFormatted = new Intl.DateTimeFormat('fr-FR', dOpt).format(date) + ' (24h)';
                } catch (e) {
                    dateFormatted = date.toLocaleDateString('fr-FR') + ' (24h)';
                }
            } else {
                try {
                    dateFormatted = validityFormat.format(date).replace(':', 'h');
                } catch (e) {
                    dateFormatted = date.toLocaleTimeString('fr-FR');
                }
                leadStr = 'H+' + String(step.lead_hour).padStart(2, '0');
                if (dayOffset >= 1) {
                    leadStr = 'J+' + dayOffset + ' (' + leadStr + ')';
                }
            }
            if (validity) validity.textContent = dateFormatted;
            if (lead) lead.textContent = leadStr;
            var layer = manifest.layers[currentLayer];
            if (viewport) {
                viewport.setAttribute(
                    'aria-label',
                    (layer ? layer.label : 'Carte météo') + ' — ' + dateFormatted
                );
            }
            if (mapTitle) {
                mapTitle.textContent = (layer ? layer.label : 'Carte Météo') +
                    (layer && layer.unit ? ' (' + layer.unit + ')' : '');
            }
            if (mapDate) {
                mapDate.textContent = dateFormatted + ' (' + leadStr + ')';
            }
            // Ligne d'en-tête en haut à gauche : paramètre + échéance (comme météociel)
            var headline = app.querySelector('[data-amfm-headline]');
            if (headline) {
                var layerName = layer ? layer.label : currentLayer;
                var runLabel = '';
                try {
                    runLabel = runFormat.format(new Date(step.valid_time)).replace(':', 'h');
                } catch (e) {
                    runLabel = dateFormatted;
                }
                headline.innerHTML = '';
                var layerSpan = document.createElement('span');
                layerSpan.className = 'amfm-headline-layer';
                layerSpan.textContent = layerName +
                    (layer && layer.unit ? ' (' + layer.unit + ')' : '') + ' — ';
                headline.appendChild(layerSpan);
                headline.appendChild(document.createTextNode(runLabel + ' ' + leadStr));
            }

            // Mise à jour du cartouche intégré directement sur la carte (TV, Plein écran & Normal)
            if (badgeParam) {
                var prettyL = layer ? layer.label : currentLayer;
                var prettyU = (layer && layer.unit) ? ' (' + layer.unit + ')' : '';
                badgeParam.textContent = prettyL + prettyU;
            }
            if (badgeModel) {
                var mTitle = (manifest && manifest.model_name) ? manifest.model_name : 'Modèle météo';
                var rTag = '';
                if (manifest && manifest.run_time) {
                    try {
                        rTag = ' • Run ' + String(manifest.run_time).slice(11, 16) + 'Z';
                    } catch (e) {}
                }
                badgeModel.textContent = mTitle + rTag;
            }
            if (badgeDate) {
                badgeDate.innerHTML = dateFormatted + ' <span class="amfm-badge-lead">(' + leadStr + ')</span>';
            }

            clearError();
            clearUnavailable();
            if (loading) loading.hidden = false;
            hideProbe();
            var token = ++loadToken;
            var fileRel = step && step.files && step.files[currentLayer];
            if (!fileRel) {
                if (token === loadToken) {
                    if (loading) loading.hidden = true;
                    if (webgl) {
                        webgl.ready = false;
                    }
                    currentWeatherImage = null;
                    scheduleRender();
                    showUnavailable('Paramètre non disponible pour ce modèle');
                }
                return;
            }
            var nextSource = versioned(fileRel);
            loadProbe(step);
            var loader = new Image();
            loader.crossOrigin = 'anonymous';
            loader.onload = function () {
                if (token !== loadToken) {
                    return;
                }
                clearUnavailable();
                uploadWeatherImage(loader);
                prepareImageSampler(loader);
                if (loading) loading.hidden = true;
                preloadNeighbour(steps, currentStep);
            };
            loader.onerror = function () {
                if (token === loadToken) {
                    if (loading) loading.hidden = true;
                    if (webgl) {
                        webgl.ready = false;
                    }
                    currentWeatherImage = null;
                    scheduleRender();
                    showUnavailable('Donnée non disponible pour cette échéance');
                }
            };
            loader.src = nextSource;
        }

        
        window.addEventListener('layerchange', function (e) {
            if (e.detail && e.detail.layer) {
                setLayer(e.detail.layer);
            }
        });

        // Centre vertical du viewport — le header flotte par-dessus la carte
        // (translucide), donc tous les zooms/pans/focus s'expriment par
        // rapport au centre de l'écran.
        function mapCenterY(height) {
            return (height || viewport.clientHeight) / 2;
        }

        function focusOnPoint(u, v, scale) {
            var w = viewport.clientWidth;
            var h = viewport.clientHeight;
            var s = (w / h) > (2200.0 / 1640.0) ?
                (w / 2200.0) : (h / 1640.0);
            var targetScale = clamp(scale || 1, 1, maxScale);
            transform.scale = targetScale;
            // Projection UNIQUE (même base que computeMapRect) : le point
            // (u,v) du raster se retrouve au centre du viewport.
            transform.x = 2200.0 * s * targetScale * (0.5 - u);
            transform.y = 1640.0 * s * targetScale * (0.5 - v);
            applyTransform();
        }

        var regionSelect = app.querySelector('[data-amfm-region-select]');
        if (regionSelect) {
                        var REGION_CONFIG = {
                europe:     { isDomain: 'eu', latitude: 49.0, longitude: 8.0, scale: 1.0 },
                france:     { isDomain: 'fr', reset: true },
                hdf:        { isDomain: 'fr', latitude: 49.85, longitude: 2.82, scale: 2.65 },
                normandie:  { isDomain: 'fr', latitude: 48.95, longitude: -0.07, scale: 2.85 },
                idf:        { isDomain: 'fr', latitude: 48.65, longitude: 2.50, scale: 4.20 },
                grandest:   { isDomain: 'fr', latitude: 48.65, longitude: 5.80, scale: 2.25 },
                bretagne:   { isDomain: 'fr', latitude: 48.00, longitude: -3.08, scale: 2.80 },
                pdl:        { isDomain: 'fr', latitude: 47.30, longitude: -0.85, scale: 2.75 },
                cvl:        { isDomain: 'fr', latitude: 47.45, longitude: 1.60, scale: 2.55 },
                bfc:        { isDomain: 'fr', latitude: 47.10, longitude: 5.00, scale: 2.65 },
                naq:        { isDomain: 'fr', latitude: 44.95, longitude: 0.40, scale: 1.85 },
                ara:        { isDomain: 'fr', latitude: 45.30, longitude: 4.65, scale: 2.25 },
                occitanie:  { isDomain: 'fr', latitude: 43.50, longitude: 2.25, scale: 2.25 },
                paca:       { isDomain: 'fr', latitude: 43.85, longitude: 6.00, scale: 2.85 },
                corse:      { isDomain: 'fr', latitude: 42.10, longitude: 9.05, scale: 4.20 },

                // 🇪🇺 Pays d'Europe (domaine Europe Lambert)
                belgique:   { isDomain: 'eu', latitude: 50.50, longitude: 4.50, scale: 3.60 },
                suisse:     { isDomain: 'eu', latitude: 46.80, longitude: 8.20, scale: 3.80 },
                autriche:   { isDomain: 'eu', latitude: 47.50, longitude: 14.00, scale: 3.20 },
                portugal:   { isDomain: 'eu', latitude: 39.50, longitude: -8.00, scale: 3.00 },
                espagne:    { isDomain: 'eu', latitude: 40.20, longitude: -3.80, scale: 2.40 },
                italie:     { isDomain: 'eu', latitude: 42.50, longitude: 12.50, scale: 2.60 },
                allemagne:  { isDomain: 'eu', latitude: 51.20, longitude: 10.40, scale: 2.40 },
                paysbas:    { isDomain: 'eu', latitude: 52.20, longitude: 5.30, scale: 3.60 },
                uk:         { isDomain: 'eu', latitude: 54.20, longitude: -2.80, scale: 2.80 },
                irlande:    { isDomain: 'eu', latitude: 53.30, longitude: -7.80, scale: 3.40 },
                grece:      { isDomain: 'eu', latitude: 38.50, longitude: 23.00, scale: 2.80 },
                pologne:    { isDomain: 'eu', latitude: 52.00, longitude: 19.50, scale: 2.30 },
                suede:      { isDomain: 'eu', latitude: 59.50, longitude: 16.50, scale: 2.10 },
                norvege:    { isDomain: 'eu', latitude: 61.50, longitude: 9.00, scale: 2.10 },
                finlande:   { isDomain: 'eu', latitude: 63.00, longitude: 26.50, scale: 2.10 },
                danemark:   { isDomain: 'eu', latitude: 56.00, longitude: 10.50, scale: 3.60 },
                islande:    { isDomain: 'eu', latitude: 64.80, longitude: -18.50, scale: 3.20 },
                rep_tcheque:{ isDomain: 'eu', latitude: 49.80, longitude: 15.50, scale: 3.50 },
                hongrie:    { isDomain: 'eu', latitude: 47.15, longitude: 19.50, scale: 3.50 },
                roumanie:   { isDomain: 'eu', latitude: 45.80, longitude: 25.00, scale: 2.80 },
                croatie:    { isDomain: 'eu', latitude: 45.00, longitude: 16.00, scale: 3.20 },

                // 🌍 Maghreb & Méditerranée
                maroc:      { isDomain: 'eu', latitude: 31.80, longitude: -6.50, scale: 2.30 },
                algerie:    { isDomain: 'eu', latitude: 35.50, longitude: 3.50, scale: 2.10 },
                tunisie:    { isDomain: 'eu', latitude: 35.50, longitude: 9.80, scale: 3.20 },
                egypte:     { isDomain: 'eu', latitude: 29.50, longitude: 31.00, scale: 2.20 },
                turquie:    { isDomain: 'eu', latitude: 39.00, longitude: 35.00, scale: 2.20 },
                russie:     { isDomain: 'eu', latitude: 56.00, longitude: 40.00, scale: 1.90 },

                // 🌎 Amérique du Nord
                canada:     { isDomain: 'etats_unis', latitude: 49.00, longitude: -95.00, scale: 1.80 },
                etats_unis: { isDomain: 'etats_unis', reset: true },

                // 🌏 Asie & Eurasie
                japon:      { isDomain: 'pacifique_ouest', latitude: 36.50, longitude: 138.00, scale: 2.60 },
                chine:      { isDomain: 'pacifique_ouest', latitude: 32.00, longitude: 115.00, scale: 1.80 },
                coree:      { isDomain: 'pacifique_ouest', latitude: 36.50, longitude: 128.00, scale: 3.60 },
                inde:       { isDomain: 'ocean_indien_nord', latitude: 22.00, longitude: 78.00, scale: 1.90 },

                // 🌀 Outre-Mer & Bassins cycloniques
                antilles:           { isDomain: 'antilles', reset: true },
                ocean_indien:       { isDomain: 'ocean_indien', reset: true },
                pacifique_ouest:    { isDomain: 'pacifique_ouest', reset: true },
                pacifique_sud:      { isDomain: 'pacifique_sud', reset: true },
                pacifique_est:      { isDomain: 'pacifique_est', reset: true },
                ocean_indien_nord:  { isDomain: 'ocean_indien_nord', reset: true }
            };

            var MODEL_FAMILY = {
                arpege: { eu: 'arpege', fr: 'arpege_france', ant: 'gfs_antilles', usa: 'gfs_etats_unis' },
                arpege_france: { eu: 'arpege', fr: 'arpege_france', ant: 'gfs_antilles', usa: 'gfs_etats_unis' },
                icon_eu: { eu: 'icon_eu', fr: 'icon_eu_france', ant: 'gfs_antilles', usa: 'gfs_etats_unis' },
                icon_eu_france: { eu: 'icon_eu', fr: 'icon_eu_france', ant: 'gfs_antilles', usa: 'gfs_etats_unis' },
                gfs: { eu: 'gfs', fr: 'gfs_france', ant: 'gfs_antilles', usa: 'gfs_etats_unis' },
                gfs_france: { eu: 'gfs', fr: 'gfs_france', ant: 'gfs_antilles', usa: 'gfs_etats_unis' },
                gfs_antilles: { eu: 'gfs', fr: 'gfs_france', ant: 'gfs_antilles', usa: 'gfs_etats_unis' },
                gfs_etats_unis: { eu: 'gfs', fr: 'gfs_france', ant: 'gfs_antilles', usa: 'gfs_etats_unis' },
                aifs: { eu: 'aifs', fr: 'aifs_france', ant: 'aifs_antilles', usa: 'aifs_etats_unis' },
                aifs_france: { eu: 'aifs', fr: 'aifs_france', ant: 'aifs_antilles', usa: 'aifs_etats_unis' },
                aifs_antilles: { eu: 'aifs', fr: 'aifs_france', ant: 'aifs_antilles', usa: 'aifs_etats_unis' },
                aifs_etats_unis: { eu: 'aifs', fr: 'aifs_france', ant: 'aifs_antilles', usa: 'aifs_etats_unis' }
            };

                        regionSelect.addEventListener('change', function (e) {
                var val = e.target.value || 'france';
                var cfg = REGION_CONFIG[val] || { isDomain: 'fr', reset: true };

                // Détermination du modèle cible
                var family = 'gfs';
                if (currentModel && currentModel.indexOf('aifs') !== -1) family = 'aifs';
                else if (currentModel && currentModel.indexOf('arpege') !== -1) family = 'arpege';
                else if (currentModel && currentModel.indexOf('icon') !== -1) family = 'icon_eu';

                var targetModel = 'gfs';
                if (cfg.isDomain === 'fr') {
                    targetModel = (family === 'aifs') ? 'aifs_france' : ((family === 'arpege') ? 'arpege_france' : 'gfs_france');
                } else if (cfg.isDomain === 'eu') {
                    targetModel = (family === 'aifs') ? 'aifs' : ((family === 'arpege') ? 'arpege' : 'gfs');
                } else {
                    targetModel = (family === 'aifs' ? 'aifs_' : 'gfs_') + cfg.isDomain;
                }

                if (cfg.reset) {
                    transform = { scale: 1, x: 0, y: 0 };
                    if (currentModel !== targetModel) {
                        switchModel(targetModel);
                    } else {
                        resetView();
                    }
                } else {
                    var focus = {
                        latitude: cfg.latitude,
                        longitude: cfg.longitude,
                        scale: cfg.scale || 2.5
                    };
                    if (currentModel !== targetModel) {
                        pendingFocus = focus;
                        switchModel(targetModel);
                    } else {
                        focusLocation(focus);
                    }
                }
                updateUrl();
            });

        }

        // Raccordement direct et robuste des menus déroulants
        var layerSelect = document.getElementById('direct-layer-select');
        if (layerSelect) {
            layerSelect.addEventListener('change', function(e) {
                setLayer(e.target.value);
            });
        }

        var z500StyleSelect = document.getElementById('z500-style');
        if (z500StyleSelect) {
            z500StyleSelect.addEventListener('change', function (e) {
                setLayer(e.target.value);
            });
        }

        var switchToken = 0; // ponytail: guard anti-double-switch — pas de AbortController pour IE11
        var pendingStepLead = null;

        function switchModel(modelKey) {
            var token = ++switchToken; // invalide tout fetch précédent
            var modelMap = {
                consensus: { path: 'output/consensus', name: 'CONSENSUS Europe', badge: 'Moyenne' },
                consensus_france: { path: 'output/consensus_france', name: 'CONSENSUS France HD', badge: '0,1°' },
                probabilites: { path: 'output/probabilites', name: 'PROBABILITÉS Europe', badge: '24h' },
                probabilites_france: { path: 'output/probabilites_france', name: 'PROBABILITÉS France', badge: '24h' },
                gfs: { path: 'output/gfs', name: 'GFS Europe', badge: '0,25°' },
                gfs_france: { path: 'output/gfs_france', name: 'GFS France', badge: '0,25°' },
                gfs_antilles: { path: 'output/gfs_antilles', name: 'GFS Arc Antillais', badge: '0,25°' },
                gfs_etats_unis: { path: 'output/gfs_etats_unis', name: 'GFS États-Unis', badge: '0,25°' },
                arpege: { path: 'output/arpege', name: 'ARPEGE Europe', badge: '0,25°' },
                arpege_france: { path: 'output/arpege_france', name: 'ARPEGE France', badge: '0,1°' },
                icon_eu: { path: 'output/icon_eu', name: 'ICON-EU Europe', badge: '7 km' },
                icon_eu_france: { path: 'output/icon_eu_france', name: 'ICON-EU France', badge: '7 km' },
                aifs: { path: 'output/aifs', name: 'ECMWF AIFS Europe', badge: '0,25°' },
                aifs_france: { path: 'output/aifs_france', name: 'ECMWF AIFS France', badge: '0,25°' },
                aifs_antilles: { path: 'output/aifs_antilles', name: 'ECMWF AIFS Arc Antillais', badge: '0,25°' },
                aifs_etats_unis: { path: 'output/aifs_etats_unis', name: 'ECMWF AIFS États-Unis', badge: '0,25°' },
                gfs_ocean_indien: { path: 'output/gfs_ocean_indien', name: 'GFS Océan Indien Sud-Ouest', badge: '0,25°' },
                aifs_ocean_indien: { path: 'output/aifs_ocean_indien', name: 'AIFS Océan Indien Sud-Ouest', badge: '0,25°' },
                gfs_pacifique_ouest: { path: 'output/gfs_pacifique_ouest', name: 'GFS Pacifique Ouest / Typhons', badge: '0,25°' },
                aifs_pacifique_ouest: { path: 'output/aifs_pacifique_ouest', name: 'AIFS Pacifique Ouest / Typhons', badge: '0,25°' },
                gfs_pacifique_sud: { path: 'output/gfs_pacifique_sud', name: 'GFS Pacifique Sud & Océanie', badge: '0,25°' },
                aifs_pacifique_sud: { path: 'output/aifs_pacifique_sud', name: 'AIFS Pacifique Sud & Océanie', badge: '0,25°' },
                gfs_pacifique_est: { path: 'output/gfs_pacifique_est', name: 'GFS Pacifique Est & Hawaï', badge: '0,25°' },
                aifs_pacifique_est: { path: 'output/aifs_pacifique_est', name: 'AIFS Pacifique Est & Hawaï', badge: '0,25°' },
                gfs_ocean_indien_nord: { path: 'output/gfs_ocean_indien_nord', name: 'GFS Bengale & Mer d\'Arabie', badge: '0,25°' },
                aifs_ocean_indien_nord: { path: 'output/aifs_ocean_indien_nord', name: 'AIFS Bengale & Mer d\'Arabie', badge: '0,25°' }
            };
            var target = modelMap[modelKey] || modelMap.gfs;
            var prevBaseUrl = baseUrl;
            baseUrl = target.path;
            app.dataset.baseUrl = target.path;
            app.dataset.model = modelKey;

            var titleSpan = document.querySelector('.amfm-title-text');
            if (titleSpan) {
                titleSpan.textContent = target.name;
            }
            var badge = document.querySelector('.amfm-badge');
            if (badge) {
                badge.textContent = target.badge;
            }

            if (loading) loading.hidden = false;
            fetchJson(baseUrl + '/maps/index.json')
                .then(function(payload) {
                    // Un switch plus récent a été lancé entre-temps → ignorer
                    if (token !== switchToken) return;

                    if (!payload || !payload.layers || !Array.isArray(payload.steps)) {
                        throw new Error('manifeste invalide');
                    }
                    manifest = payload;
                    applyPaletteStops();
                    currentStep = 0;
                    if (payload.overlay && typeof loadVectorOverlay === 'function') {
                        loadVectorOverlay(payload.overlay);
                    }
                    if (typeof loadPlaces === 'function') {
                        loadPlaces();
                    }
                    if (payload.fond) {
                        fondImageElement = new Image();
                        fondImageElement.crossOrigin = 'anonymous';
                        fondImageElement.src = versioned(payload.fond);
                        if (webgl) {
                            var fImg = new Image();
                            fImg.crossOrigin = 'anonymous';
                            fImg.src = versioned(payload.fond);
                            fImg.onload = function () {
                                if (!webgl) return;
                                var gl = webgl.gl;
                                gl.activeTexture(gl.TEXTURE2);
                                gl.bindTexture(gl.TEXTURE_2D, webgl.fondTexture);
                                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, fImg);
                                webgl.fondReady = true;
                                scheduleRender();
                            };
                        }
                    }
                    if (payload.mask) {
                        franceMaskImage = new Image();
                        franceMaskImage.crossOrigin = 'anonymous';
                        franceMaskImage.src = versioned(payload.mask);
                        franceMaskImage.onload = function () {
                            alphaMaskCanvas = null;
                            if (maskSamplerContext) {
                                try {
                                    var mNatH = isWorldDomain(modelKey) ? 1320 : 1640;
                                    maskSamplerCanvas.height = mNatH;
                                    maskSamplerContext.drawImage(franceMaskImage, 0, 0, 2200, mNatH);
                                    maskSamplerReady = true;
                                } catch (e) {}
                            }
                            if (webgl) {
                                var gl = webgl.gl;
                                gl.activeTexture(gl.TEXTURE1);
                                gl.bindTexture(gl.TEXTURE_2D, webgl.maskTexture);
                                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, franceMaskImage);
                                webgl.maskReady = true;
                            }
                            scheduleRender();
                        };
                    }
                    var isFranceOnly = (modelKey.indexOf('_france') !== -1);
                    var isArpegeEu = (modelKey === 'arpege');
                    var dSel = document.getElementById('direct-layer-select');
                    if (dSel) {
                        var z500Opt = dSel.querySelector('option[value="geopotentiel_500"]');
                        if (z500Opt) z500Opt.disabled = !(manifest.layers && manifest.layers['geopotentiel_500']);
                        var t850Opt = dSel.querySelector('option[value="temperature_850"]');
                        if (t850Opt) t850Opt.disabled = !(manifest.layers && manifest.layers['temperature_850']);

                        // Pour ARPEGE Europe : masquer tout le groupe températures sol (garder seulement T850 en altitude)
                        var tempGroup = dSel.querySelector('optgroup[label*="Températures"]');
                        if (tempGroup) {
                            tempGroup.hidden = isArpegeEu;
                            tempGroup.style.display = isArpegeEu ? 'none' : '';
                        }
                        // 24h min/max : uniquement sur les modèles France
                        var tnOpt = dSel.querySelector('option[value="temperature_min_24h"]');
                        if (tnOpt) { tnOpt.hidden = !isFranceOnly; tnOpt.style.display = isFranceOnly ? '' : 'none'; }
                        var txOpt = dSel.querySelector('option[value="temperature_max_24h"]');
                        if (txOpt) { txOpt.hidden = !isFranceOnly; txOpt.style.display = isFranceOnly ? '' : 'none'; }
                    }
                    if (isArpegeEu && (currentLayer === 'temperature' || currentLayer === 'temperature_ressentie' || currentLayer === 'point_rosee' || currentLayer === 'humidex' || currentLayer === 'temperature_min_24h' || currentLayer === 'temperature_max_24h')) {
                        currentLayer = 'geopotentiel_500';
                        if (dSel) dSel.value = 'geopotentiel_500';
                    }
                    var regSel = document.getElementById('select-region');
                    if (regSel) {
                        var grpFr = regSel.querySelector('#optgroup-fr');
                        var grpEu = regSel.querySelector('#optgroup-eu');
                        var grpWorld = regSel.querySelector('#optgroup-world');
                        if (grpFr) { grpFr.hidden = !isFranceOnly; grpFr.style.display = isFranceOnly ? '' : 'none'; }
                        if (grpEu) { grpEu.hidden = isFranceOnly; grpEu.style.display = isFranceOnly ? 'none' : ''; }
                        if (grpWorld) { grpWorld.hidden = isFranceOnly; grpWorld.style.display = isFranceOnly ? 'none' : ''; }
                        // Filtrage intelligent : montrer uniquement les options pertinentes
                        var allOpts = regSel.querySelectorAll('option');
                        for (var oi = 0; oi < allOpts.length; oi++) {
                            var opt = allOpts[oi];
                            if (isFranceOnly) {
                                opt.hidden = opt.classList.contains('opt-eu') || opt.classList.contains('opt-world');
                            } else {
                                opt.hidden = opt.classList.contains('opt-fr');
                            }
                        }
                        // Basculer sur une valeur visible si la valeur actuelle est masquée
                        var curOpt = regSel.querySelector('option[value="' + regSel.value + '"]');
                        if (!curOpt || curOpt.hidden) {
                            regSel.value = isFranceOnly ? 'hdf' : 'europe';
                        }
                    }

                    if (pendingLayer && manifest.layers && manifest.layers[pendingLayer]) {
                        currentLayer = pendingLayer;
                        pendingLayer = null;
                        if (dSel) dSel.value = currentLayer;
                    } else if (!manifest.layers[currentLayer]) {
                        currentLayer = manifest.layers['geopotentiel_500'] ? 'geopotentiel_500' : (Object.keys(manifest.layers)[0] || 'temperature');
                        if (dSel) dSel.value = currentLayer;
                    }
                    if (typeof buildLayerMenu === 'function') buildLayerMenu();
                    buildLegend();
                    updateZ500StyleToggle();
                    currentModel = modelKey;
                    var modelSel2 = document.getElementById('select-model');
                    if (modelSel2) modelSel2.value = modelKey;
                    if (regSel) {
                        var worldKeys = ['antilles', 'etats_unis', 'pacifique_est', 'pacifique_ouest', 'pacifique_sud', 'ocean_indien_nord', 'ocean_indien'];
                        for (var wi = 0; wi < worldKeys.length; wi++) {
                            if (modelKey.indexOf('_' + worldKeys[wi]) !== -1) {
                                regSel.value = worldKeys[wi];
                                break;
                            }
                        }
                    }
                    var stepIdx = 0;
                    var steps = availableSteps();
                    if (pendingStepLead !== null && pendingStepLead !== undefined && steps && steps.length > 0) {
                        var bestDiff = 999999;
                        for (var si = 0; si < steps.length; si++) {
                            var sDiff = Math.abs((steps[si].lead_hour || 0) - pendingStepLead);
                            if (sDiff < bestDiff) {
                                bestDiff = sDiff;
                                stepIdx = si;
                            }
                        }
                        pendingStepLead = null;
                    }
                    renderStep(stepIdx);
                    updateUrl();
                    if (loading) loading.hidden = true;

                    if (pendingFocus && typeof focusLocation === 'function') {
                        focusLocation(pendingFocus);
                        pendingFocus = null;
                    } else if (regSel) {
                        var curVal = regSel.value;
                        var rcfg = REGION_CONFIG[curVal];
                        if (rcfg && rcfg.isFrance === isFranceOnly && typeof focusLocation === 'function') {
                            if (rcfg.reset) {
                                resetView();
                            } else if (rcfg.latitude !== undefined) {
                                focusLocation({ latitude: rcfg.latitude, longitude: rcfg.longitude, scale: rcfg.scale });
                            }
                        } else {
                            resetView();
                        }
                    }
                })
                .catch(function(err) {
                    if (loading) loading.hidden = true;
                    if (token !== switchToken) return;
                    console.error('[switchModel] Erreur chargement manifeste', target.path, err);
                    if (modelKey.indexOf('aifs_') === 0) {
                        var gfsFallback = 'gfs_' + modelKey.substring(5);
                        console.warn('[switchModel] Modèle AIFS non disponible, bascule sur', gfsFallback);
                        showError('Modèle ' + target.name + ' en cours de génération — bascule sur GFS.');
                        window.setTimeout(function() { clearError(); }, 4000);
                        switchModel(gfsFallback);
                        return;
                    }
                    showError('Modèle ' + target.name + ' non disponible — affichage GFS Europe.');
                    window.setTimeout(function() { clearError(); }, 4000);
                    if (modelKey !== 'gfs') {
                        var modelSel = document.getElementById('select-model');
                        if (modelSel) modelSel.value = 'gfs';
                        var regSel = document.getElementById('select-region');
                        if (regSel) regSel.value = 'europe';
                        switchModel('gfs');
                    }
                });
        }

        var modelSelect = document.getElementById('select-model');
        if (modelSelect) {
            modelSelect.addEventListener('change', function(e) {
                var nextModel = e.target.value;
                var isNextWorld = isWorldDomain(nextModel);
                var isCurrentWorld = isWorldDomain(currentModel);
                var isNextFrance = (nextModel.indexOf('_france') !== -1);
                var isCurrentFrance = (currentModel.indexOf('_france') !== -1);
                var regSel = document.getElementById('select-region');

                if (isNextWorld) {
                    pendingFocus = null;
                    transform = { scale: 1, x: 0, y: 0 };
                    if (regSel) {
                        var worldKeys = ['antilles', 'etats_unis', 'pacifique_est', 'pacifique_ouest', 'pacifique_sud', 'ocean_indien_nord', 'ocean_indien'];
                        for (var wi = 0; wi < worldKeys.length; wi++) {
                            if (nextModel.indexOf('_' + worldKeys[wi]) !== -1) {
                                regSel.value = worldKeys[wi];
                                break;
                            }
                        }
                    }
                } else if (isCurrentWorld || (isNextFrance !== isCurrentFrance)) {
                    // Bascule de domaine (Monde / France / Europe) : reset immédiat et complet du cadrage
                    pendingFocus = null;
                    transform = { scale: 1, x: 0, y: 0 };
                    if (regSel) {
                        regSel.value = isNextFrance ? 'france' : 'europe';
                    }
                } else {
                    // Même domaine : on conserve la région active si elle est zoomée
                    var activeRegion = regSel ? regSel.value : '';
                    if (activeRegion && activeRegion !== 'france' && activeRegion !== 'europe') {
                        var cfg = REGION_CONFIG[activeRegion];
                        if (cfg && !cfg.reset && cfg.latitude !== undefined) {
                            pendingFocus = {
                                latitude: cfg.latitude,
                                longitude: cfg.longitude,
                                scale: cfg.scale
                            };
                        }
                    }
                }
                switchModel(nextModel);
            });
        }

        // ponytail: duplicate regionSelect removed (handled above via focusOnPoint)
        var pendingLayer = null;

        function setLayer(layer) {
            if (!manifest || !manifest.layers[layer]) {
                if (layer === 'vagues' || layer === 'periode_vagues') {
                    // Les vagues sont issues du couplage mondial GFS Wave (NWW3) :
                    // Basculer automatiquement sur GFS France ou GFS Europe
                    var targetModel = (currentModel.indexOf('_france') !== -1) ? 'gfs_france' : 'gfs';
                    if (currentModel !== targetModel) {
                        pendingLayer = layer;
                        var modelSel = document.getElementById('select-model');
                        if (modelSel) modelSel.value = targetModel;
                        switchModel(targetModel);
                        return;
                    }
                }
                return;
            }
            currentLayer = layer;
            var dSel = document.getElementById('direct-layer-select');
            var baseKey = (layer.indexOf('_meteociel') !== -1) ? 'geopotentiel_500' : layer;
            if (dSel && dSel.value !== baseKey) {
                dSel.value = baseKey;
            }
            refreshLayerMenu();
            buildLegend();
            updateZ500StyleToggle();
            var steps = availableSteps();
            currentStep = clamp(currentStep, 0, Math.max(0, steps.length - 1));
            renderStep(currentStep);
        }

        // ── Sélecteur de style des contours Z500 (Dense / Météociel) ──────────
        function updateZ500StyleToggle() {
            var toggle = document.getElementById('z500-style');
            if (!toggle) {
                return;
            }
            var isZ500 = (currentLayer === 'geopotentiel_500' || currentLayer === 'geopotentiel_500_meteociel');
            var hasVariant = !!(manifest && manifest.layers && manifest.layers['geopotentiel_500_meteociel']);
            toggle.style.display = (isZ500 && hasVariant) ? '' : 'none';
            if (isZ500 && toggle.value !== currentLayer) {
                toggle.value = currentLayer;
            }
        }

        // ── État dans l'URL (style meteo-npdc.fr) ─────────────────────────────
        function updateUrl() {
            if (isInitializing) {
                return;
            }
            if (!window.history || !window.history.replaceState) {
                return;
            }
            var params = new URLSearchParams(window.location.search);
            params.set('model', currentModel);
            params.set('parametre', currentLayer);
            var regSel = document.getElementById('select-region');
            if (regSel) params.set('region', regSel.value);
            params.set('heure', String(currentStep));
            var steps = availableSteps();
            if (steps && steps[currentStep] && steps[currentStep].lead_hour !== undefined) {
                params.set('lead', String(steps[currentStep].lead_hour));
            }
            window.history.replaceState(null, '', window.location.pathname + '?' + params.toString());
        }

        function applyUrlParams() {
            var params = urlInitParams;
            var p = params.get('parametre') || params.get('layer');
            if (p && manifest && manifest.layers[p]) {
                currentLayer = p;
                var dSel = document.getElementById('direct-layer-select');
                var baseKey = (p.indexOf('_meteociel') !== -1) ? 'geopotentiel_500' : p;
                if (dSel && dSel.value !== baseKey) {
                    dSel.value = baseKey;
                }
                if (typeof refreshLayerMenu === 'function') refreshLayerMenu();
                buildLegend();
                updateZ500StyleToggle();
            }
            var reg = params.get('region');
            var regSel = document.getElementById('select-region');
            if (reg) {
                if (regSel && regSel.querySelector('option[value="' + reg + '"]')) {
                    regSel.value = reg;
                    var rcfg = REGION_CONFIG[reg];
                    if (rcfg && typeof focusLocation === 'function') {
                        if (rcfg.reset) {
                            resetView();
                        } else if (rcfg.latitude !== undefined) {
                            focusLocation({ latitude: rcfg.latitude, longitude: rcfg.longitude, scale: rcfg.scale });
                        }
                    }
                }
            } else if (regSel) {
                var isFrMod = (currentModel.indexOf('_france') !== -1);
                var defaultReg = isFrMod ? 'hdf' : 'europe';
                var worldKeys = ['antilles', 'etats_unis', 'pacifique_est', 'pacifique_ouest', 'pacifique_sud', 'ocean_indien_nord', 'ocean_indien'];
                for (var wi = 0; wi < worldKeys.length; wi++) {
                    if (currentModel.indexOf('_' + worldKeys[wi]) !== -1) {
                        defaultReg = worldKeys[wi];
                        break;
                    }
                }
                if (regSel.querySelector('option[value="' + defaultReg + '"]')) {
                    regSel.value = defaultReg;
                }
            }
            var targetLead = params.get('lead') || params.get('lead_hour');
            var targetHeure = params.get('heure');
            var steps = availableSteps();
            if (targetLead !== null && steps && steps.length > 0) {
                var leadVal = parseInt(targetLead, 10);
                if (!isNaN(leadVal)) {
                    var bestIdx = 0;
                    var bestDiff = 999999;
                    for (var si = 0; si < steps.length; si++) {
                        var diff = Math.abs((steps[si].lead_hour || 0) - leadVal);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            bestIdx = si;
                        }
                    }
                    currentStep = bestIdx;
                }
            } else if (targetHeure !== null && steps && steps.length > 0) {
                var heure = parseInt(targetHeure, 10);
                if (!isNaN(heure) && heure >= 0 && heure < steps.length) {
                    currentStep = heure;
                }
            }
        }

        function stopAnimation() {
            if (timer !== null) {
                window.clearInterval(timer);
                timer = null;
            }
            playButton.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';
            playButton.setAttribute('aria-label', 'Lancer l’animation');
            playButton.title = 'Lancer l’animation';
            playButton.classList.remove('is-playing');
        }

        function toggleAnimation() {
            if (timer !== null) {
                stopAnimation();
                return;
            }
            var steps = availableSteps();
            if (steps.length < 2) {
                return;
            }
            playButton.innerHTML = '<i class="fa-solid fa-pause" aria-hidden="true"></i>';
            playButton.setAttribute('aria-label', 'Arrêter l’animation');
            playButton.title = 'Arrêter l’animation';
            playButton.classList.add('is-playing');
            timer = window.setInterval(function () {
                var next = currentStep + 1;
                if (next >= availableSteps().length) {
                    next = 0;
                }
                renderStep(next);
            }, 1050);
        }

        function resizeCanvas(canvas, width, height, pixelRatio) {
            if (!canvas) {
                return false;
            }
            var canvasWidth = Math.max(1, Math.round(width * pixelRatio));
            var canvasHeight = Math.max(1, Math.round(height * pixelRatio));
            if (canvas.width === canvasWidth && canvas.height === canvasHeight) {
                return false;
            }
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            return true;
        }

        function compileShader(gl, type, source) {
            var shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        function initialiseWebgl() {
            if (!weatherCanvas) {
                return null;
            }
            var gl = weatherCanvas.getContext('webgl', {
                alpha: false,
                antialias: false,
                depth: false,
                preserveDrawingBuffer: false
            });
            if (!gl) {
                return null;
            }
            var vertexShader = compileShader(gl, gl.VERTEX_SHADER,
                'attribute vec2 aPosition;\n' +
                'attribute vec2 aUv;\n' +
                'varying vec2 vUv;\n' +
                'void main(){vUv=aUv;gl_Position=vec4(aPosition,0.0,1.0);}'
            );
            var fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER,
                'precision mediump float;\n' +
                'varying vec2 vUv;\n' +
                'uniform sampler2D uWeather;\n' +
                'uniform sampler2D uMask;\n' +
                'uniform sampler2D uFond;\n' +
                'uniform vec2 uViewport;\n' +
                'uniform vec4 uRect;\n' +
                'uniform float uHasWeather;\n' +
                'uniform float uHasMask;\n' +
                'uniform float uHasFond;\n' +
                'uniform float uMaskSea;\n' +
                'void main(){\n' +
                ' vec3 frame=vec3(0.02745,0.04314,0.07843);\n' +
                ' if(uRect.z<=0.0||uRect.w<=0.0){gl_FragColor=vec4(frame,1.0);return;}\n' +
                ' vec2 uv=(vUv*uViewport-uRect.xy)/uRect.zw;\n' +
                ' if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){\n' +
                '  gl_FragColor=vec4(frame,1.0);return;\n' +
                ' }\n' +
                ' vec3 base=frame;\n' +
                ' float land=1.0;\n' +
                ' if(uHasMask>0.5){\n' +
                '  land=texture2D(uMask,uv).r;\n' +
                ' }\n' +
                ' vec3 seaBlue=vec3(0.11,0.26,0.50);\n' +
                ' if(uHasFond>0.5){\n' +
                '  vec3 fondColor=texture2D(uFond,uv).rgb;\n' +
                '  if(uMaskSea>0.5){\n' +
                '   base=mix(seaBlue,fondColor,smoothstep(0.02,0.4,land));\n' +
                '  } else {\n' +
                '   base=fondColor;\n' +
                '  }\n' +
                ' } else if(uHasMask>0.5){\n' +
                '  if(uMaskSea>0.5){\n' +
                '   base=mix(seaBlue,vec3(0.76,0.78,0.81),smoothstep(0.02,0.4,land));\n' +
                '  } else {\n' +
                '   base=mix(vec3(0.6471,0.6510,0.6902),vec3(0.76,0.78,0.81),land);\n' +
                '  }\n' +
                ' }\n' +
                ' if(uHasWeather<0.5){\n' +
                '  gl_FragColor=vec4(base,1.0);return;\n' +
                ' }\n' +
                ' vec4 weather=texture2D(uWeather,uv);\n' +
                ' float alpha=weather.a;\n' +
                ' if(uMaskSea>0.5){\n' +
                '  alpha=alpha*smoothstep(0.02,0.4,land);\n' +
                ' }\n' +
                ' gl_FragColor=vec4(mix(base,weather.rgb,alpha),1.0);\n' +
                '}'
            );
            if (!vertexShader || !fragmentShader) {
                return null;
            }
            var program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                return null;
            }
            gl.useProgram(program);

            var positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([
                    -1, -1,
                     1, -1,
                    -1,  1,
                     1,  1
                ]),
                gl.STATIC_DRAW
            );

            var uvBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([
                    0, 1,
                    1, 1,
                    0, 0,
                    1, 0
                ]),
                gl.STATIC_DRAW
            );

            var position = gl.getAttribLocation(program, 'aPosition');
            var uv = gl.getAttribLocation(program, 'aUv');
            gl.enableVertexAttribArray(position);
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(uv);
            gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
            gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);

            var texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.uniform1i(gl.getUniformLocation(program, 'uWeather'), 0);

            var maskTexture = gl.createTexture();
            var maskImage = new Image();
            maskImage.crossOrigin = 'anonymous';
            maskImage.src = resolvePath((manifest && manifest.mask) ? manifest.mask : 'maps/mask_france.png');
            maskImage.onload = function() {
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, maskTexture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskImage);
                webgl.maskReady = true;
                scheduleRender();
            };

            var fondTexture = gl.createTexture();
            var fondImage = new Image();
            fondImage.crossOrigin = 'anonymous';
            fondImage.src = resolvePath((manifest && manifest.fond) ? manifest.fond : 'maps/fond.webp');
            fondImage.onload = function() {
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, fondTexture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, fondImage);
                webgl.fondReady = true;
                scheduleRender();
            };

            return {
                gl: gl,
                program: program,
                texture: texture,
                maskTexture: maskTexture,
                fondTexture: fondTexture,
                viewportSize: gl.getUniformLocation(program, 'uViewport'),
                mapRect: gl.getUniformLocation(program, 'uRect'),
                hasWeather: gl.getUniformLocation(program, 'uHasWeather'),
                maskSampler: gl.getUniformLocation(program, 'uMask'),
                useMask: gl.getUniformLocation(program, 'uHasMask'),
                fondSampler: gl.getUniformLocation(program, 'uFond'),
                useFond: gl.getUniformLocation(program, 'uHasFond'),
                maskSea: gl.getUniformLocation(program, 'uMaskSea'),
                ready: false,
                maskReady: false,
                fondReady: false
            };
        }

        function uploadWeatherImage(source) {
            currentWeatherImage = source;
            if (!webgl) {
                scheduleRender();
                return;
            }
            var gl = webgl.gl;
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, webgl.texture);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                source
            );
            webgl.ready = true;
            scheduleRender();
        }

        function drawWeather(width, height, pixelRatio) {
            if (!weatherCanvas) {
                return;
            }
            resizeCanvas(weatherCanvas, width, height, pixelRatio);
            if (webgl) {
                var gl = webgl.gl;
                gl.viewport(0, 0, weatherCanvas.width, weatherCanvas.height);
                gl.useProgram(webgl.program);
                var mapRect = computeMapRect(width, height);
                gl.uniform2f(webgl.viewportSize, width, height);
                gl.uniform4f(webgl.mapRect, mapRect.x, mapRect.y, mapRect.w, mapRect.h);
                gl.uniform1f(webgl.hasWeather, webgl.ready ? 1 : 0);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, webgl.texture);
                gl.uniform1i(gl.getUniformLocation(webgl.program, 'uWeather'), 0);

                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, webgl.maskTexture);
                gl.uniform1i(webgl.maskSampler, 1);
                gl.uniform1f(webgl.useMask, webgl.maskReady ? 1 : 0);

                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, webgl.fondTexture);
                gl.uniform1i(webgl.fondSampler, 2);
                gl.uniform1f(webgl.useFond, webgl.fondReady ? 1 : 0);

                var shouldMaskSea = (seaMode === 'land' && isTemperatureLayer(currentLayer) && webgl.maskReady);
                gl.uniform1f(webgl.maskSea, shouldMaskSea ? 1 : 0);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                return;
            }
            if (!fallbackContext) {
                fallbackContext = weatherCanvas.getContext('2d');
            }
            if (!fallbackContext) {
                return;
            }
            fallbackContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            fallbackContext.fillStyle = '#0b1220';
            fallbackContext.fillRect(0, 0, width, height);
            if (!currentWeatherImage) {
                return;
            }
            // Projection UNIQUE (computeMapRect) — mêmes coordonnées que le
            // WebGL, les vecteurs, les labels et les probes.
            var mapRect = computeMapRect(width, height);
            var mrx = mapRect.x;
            var mry = mapRect.y;
            var mrw = mapRect.w;
            var mrh = mapRect.h;
            fallbackContext.imageSmoothingEnabled = true;
            fallbackContext.imageSmoothingQuality = 'high';
            var shouldMaskSea = (seaMode === 'land' && isTemperatureLayer(currentLayer));
            if (shouldMaskSea) {
                fallbackContext.fillStyle = '#1c4280';
                fallbackContext.fillRect(mrx, mry, mrw, mrh);
                if (fondImageElement && fondImageElement.complete && fondImageElement.naturalWidth) {
                    var aMask = getAlphaMaskCanvas();
                    if (aMask) {
                        var fCan = document.createElement('canvas');
                        fCan.width = width;
                        fCan.height = height;
                        var fCtx = fCan.getContext('2d');
                        fCtx.drawImage(fondImageElement, mrx, mry, mrw, mrh);
                        fCtx.save();
                        fCtx.globalCompositeOperation = 'destination-in';
                        fCtx.drawImage(aMask, mrx, mry, mrw, mrh);
                        fCtx.restore();
                        fallbackContext.drawImage(fCan, 0, 0);
                    } else {
                        fallbackContext.drawImage(fondImageElement, mrx, mry, mrw, mrh);
                    }
                }
            } else {
                if (fondImageElement && fondImageElement.complete && fondImageElement.naturalWidth) {
                    fallbackContext.drawImage(fondImageElement, mrx, mry, mrw, mrh);
                } else {
                    fallbackContext.fillStyle = '#a5a6b0';
                    fallbackContext.fillRect(mrx, mry, mrw, mrh);
                }
            }
            // Dalle météo : maillage AROME alpha-composité sur le fond
            var weatherLayer = document.createElement('canvas');
            weatherLayer.width = width;
            weatherLayer.height = height;
            var weatherLayerCtx = weatherLayer.getContext('2d');
            weatherLayerCtx.drawImage(currentWeatherImage, mrx, mry, mrw, mrh);
            if (shouldMaskSea) {
                var aMask = getAlphaMaskCanvas();
                if (aMask) {
                    weatherLayerCtx.save();
                    weatherLayerCtx.globalCompositeOperation = 'destination-in';
                    weatherLayerCtx.drawImage(aMask, mrx, mry, mrw, mrh);
                    weatherLayerCtx.restore();
                }
            }
            fallbackContext.drawImage(weatherLayer, 0, 0);
        }

        function loadVectorOverlay(path) {
            if (!path || !vectorContext || typeof window.Path2D !== 'function') {
                return Promise.resolve();
            }
            return fetchText(versioned(path)).then(function (source) {
                var documentSvg = new DOMParser().parseFromString(
                    source,
                    'image/svg+xml'
                );
                var svg = documentSvg.documentElement;
                var viewBox = String(svg.getAttribute('viewBox') || '')
                    .trim().split(/\s+/).map(Number);
                if (viewBox.length !== 4 || !viewBox[2] || !viewBox[3]) {
                    throw new Error('surcouche vectorielle invalide');
                }
                var paths = Array.from(svg.querySelectorAll('path')).map(
                    function (node) {
                        var width = Number(node.getAttribute('stroke-width') || 1);
                        // Classification par épaisseur : département (fin), région (moyen), pays/côte (épais)
                        var kind = width <= 1.0 ? 'department' : (width <= 1.6 ? 'region' : 'country');
                        return {
                            path: new Path2D(node.getAttribute('d') || ''),
                            colour: node.getAttribute('stroke') || '#101116',
                            opacity: Number(node.getAttribute('stroke-opacity') || 1),
                            width: width,
                            lineCap: node.getAttribute('stroke-linecap') || 'butt',
                            lineJoin: node.getAttribute('stroke-linejoin') || 'miter',
                            kind: kind
                        };
                    }
                );
                vectorDefinition = {
                    width: viewBox[2],
                    height: viewBox[3],
                    paths: paths
                };
                scheduleRender();
            }).catch(function () {
                vectorDefinition = null;
            });
        }

        function drawVectors(width, height, pixelRatio) {
            if (!vectorContext || !vectorDefinition) {
                return;
            }
            resizeCanvas(vectorCanvas, width, height, pixelRatio);
            vectorContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            vectorContext.clearRect(0, 0, width, height);
            // Projection UNIQUE (computeMapRect) : parfaitement alignée avec le
            // raster WebGL/2D — plus aucun décalage possible entre les deux.
            var mapRect = computeMapRect(width, height);
            var natH = isWorldDomain() ? 1320.0 : 1640.0;
            var horizontalScale = mapRect.w / 2200.0;
            var verticalScale = mapRect.h / natH;
            vectorContext.save();
            vectorContext.beginPath();
            vectorContext.rect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
            vectorContext.clip();
            vectorContext.setTransform(
                pixelRatio * horizontalScale,
                0,
                0,
                pixelRatio * verticalScale,
                pixelRatio * mapRect.x,
                pixelRatio * mapRect.y
            );
            var isFrance = (currentModel.indexOf('_france') !== -1) || (manifest && manifest.bounds && manifest.bounds.projection === 'mercator');
            if (isFrance) {
                // Copie conforme du moteur AROME interactif
                vectorDefinition.paths.forEach(function (entry) {
                    vectorContext.strokeStyle = entry.colour || '#0d1117';
                    vectorContext.globalAlpha = 1.0;
                    vectorContext.lineCap = 'round';
                    vectorContext.lineJoin = 'round';
                    vectorContext.lineWidth = (entry.width || 1.6) / horizontalScale;
                    vectorContext.stroke(entry.path);
                });
            } else {
                // Mode Europe synoptique
                vectorDefinition.paths.forEach(function (entry) {
                    var isDept = entry.kind === 'department';
                    if (isDept && transform.scale <= 1.35) {
                        return; // Masqué sur la vue globale Europe pour éviter la surcharge
                    }
                    vectorContext.strokeStyle = entry.colour || (isDept ? '#7a828e' : '#0b1220');
                    vectorContext.globalAlpha = isDept ? (transform.scale > 2.0 ? 0.9 : 0.6) : (entry.opacity || 1.0);
                    vectorContext.lineCap = 'round';
                    vectorContext.lineJoin = 'round';
                    vectorContext.lineWidth = (entry.width || (isDept ? 0.8 : 1.8)) / horizontalScale;
                    vectorContext.stroke(entry.path);
                });
            }
            vectorContext.restore();
            vectorContext.globalAlpha = 1;
        }

        function scheduleRender() {
            if (renderFrame !== null) {
                return;
            }
            renderFrame = window.requestAnimationFrame(function () {
                renderFrame = null;
                var width = viewport.clientWidth;
                var height = viewport.clientHeight;
                if (!width || !height) {
                    return;
                }
                var pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
                drawWeather(width, height, pixelRatio);
                drawVectors(width, height, pixelRatio);
                drawValues(width, height, pixelRatio);
                drawLabels(width, height, pixelRatio);
                checkCycloneAnimation();
            });
        }

        function mercator(latitude) {
            var radians = clamp(latitude, -85, 85) * Math.PI / 180;
            return Math.log(Math.tan(Math.PI / 4 + radians / 2));
        }

        function inverseMercator(value) {
            return (2 * Math.atan(Math.exp(value)) - Math.PI / 2) * 180 / Math.PI;
        }

        // ────────────────────────────────────────────────────────────────────
        // PROJECTION UNIQUE de la carte (raster 2200×1640) vers un viewport
        // de taille donnée. Tous les calques (WebGL, fallback 2D, vecteurs,
        // labels, probes, GIF, export) passent par cette fonction : ils sont
        // donc TOUJOURS parfaitement alignés, quel que soit le ratio écran.
        //
        //   - Mode « vue France » (scale ≤ 1.15) : cadrage intelligent sur le
        //     rectangle réellement couvert par le maillage (masque France).
        //     Les zones non maillées (Italie, mer, coins du trapèze AROME en
        //     Mercator) sont placées HORS du viewport : plus aucune grande
        //     zone « vide de maillage » à l'écran.
        //   - Mode zoomé (région/département) : le raster remplit le viewport
        //     en cover (le surplus est découpé, jamais de bandes, la France
        //     reste proportionnelle — jamais étirée), zoom/pan inclus.
        //
        // Retour : { x, y, w, h } en pixels CSS du viewport.
        // `t` (optionnel) : transformation à utiliser (défaut : transform
        // courant) — le GIF fige sa propre transformation pendant l'encodage.
        // Le header flotte AU-DESSUS de la carte (translucide) : la carte
        // remplit donc tout le viewport, sans zone réservée.
        // ────────────────────────────────────────────────────────────────────
        function isEuropeDomain() {
            if (!currentModel) return false;
            if (currentModel.indexOf('_france') !== -1 || isWorldDomain()) return false;
            return (currentModel === 'gfs' || currentModel === 'arpege' || currentModel === 'icon_eu' || currentModel === 'aifs');
        }

        function isWorldDomain(model) {
            var m = model || currentModel;
            if (!m) return false;
            var worldSuffixes = ['_antilles', '_ocean_indien', '_pacifique_ouest', '_pacifique_sud', '_pacifique_est', '_ocean_indien_nord', '_etats_unis'];
            for (var i = 0; i < worldSuffixes.length; i++) {
                if (m.indexOf(worldSuffixes[i]) !== -1) return true;
            }
            return false;
        }

        function computeMapRect(width, height, t) {
            t = t || transform;
            var isEurope = isEuropeDomain();
            var isWorld = isWorldDomain();

            if (isEurope || isWorld) {
                var natH = isWorld ? 1320.0 : 1640.0;
                var scale = Math.min(width / 2200.0, height / natH) * t.scale;
                return {
                    x: width / 2 + t.x - 1100.0 * scale,
                    y: height / 2 + t.y - (natH / 2.0) * scale,
                    w: 2200.0 * scale,
                    h: natH * scale
                };
            }

            var s = Math.max(width / 2200.0, height / 1640.0);

            if (t.scale <= 1.15) {
                // Vue France entière AROME : englobe TOUTE la France métropolitaine ET la Corse
                // avec marge de respiration en haut (header) et en bas (timeline d'échéances)
                var FX0 = 260;  // Ouest Bretagne
                var FX1 = 1860; // Est Corse / Alsace
                var FY0 = 110;  // Nord Dunkerque
                var FY1 = 1530; // Sud Bonifacio (Corse entièrement dégagée)
                var fw = FX1 - FX0; // 1600
                var fh = FY1 - FY0; // 1420
                var availH = Math.max(180, height - 150); // 70px timeline + 60px header + 20px marge
                var availW = Math.max(260, width - 40);
                var sFrance = Math.min(availW / (fw * 1.04), availH / (fh * 1.04));
                var cx = (FX0 + FX1) / 2; // 1060
                var cy = (FY0 + FY1) / 2; // 820
                var bboxRect = {
                    x: width / 2 - cx * sFrance,
                    y: height / 2 - cy * sFrance,
                    w: 2200.0 * sFrance,
                    h: 1640.0 * sFrance
                };
                if (t.scale <= 1.001) {
                    return bboxRect;
                }
                // Interpolation fluide entre vue France et zoom libre
                var coverScale = s * t.scale;
                var coverRect = {
                    x: width / 2 + t.x - 1100.0 * coverScale,
                    y: height / 2 + t.y - 820.0 * coverScale,
                    w: 2200.0 * coverScale,
                    h: 1640.0 * coverScale
                };
                var f = Math.max(0, Math.min(1, (t.scale - 1.001) / 0.149));
                return {
                    x: bboxRect.x + (coverRect.x - bboxRect.x) * f,
                    y: bboxRect.y + (coverRect.y - bboxRect.y) * f,
                    w: bboxRect.w + (coverRect.w - bboxRect.w) * f,
                    h: bboxRect.h + (coverRect.h - bboxRect.h) * f
                };
            }
            // Mode zoom/pan libre : cohérent avec changeZoom, pan et pinch
            var scale = s * t.scale;
            return {
                x: width / 2 + t.x - 1100.0 * scale,
                y: height / 2 + t.y - 820.0 * scale,
                w: 2200.0 * scale,
                h: 1640.0 * scale
            };
        }

        function visiblePlaces(width, height, bounds, northY, mercatorSpan, density) {
            if (transform.scale < 1.35 || !placeBuckets.size) {
                return places;
            }
            // Projection UNIQUE (computeMapRect) : même fenêtre que le raster.
            var mapRect = computeMapRect(width, height);
            var mapLeft = (0 - mapRect.x) / mapRect.w;
            var mapRight = (width - mapRect.x) / mapRect.w;
            var mapTop = (0 - mapRect.y) / mapRect.h;
            var mapBottom = (height - mapRect.y) / mapRect.h;
            var longitudeSpan = Number(bounds.east) - Number(bounds.west);
            var west = Number(bounds.west) + mapLeft * longitudeSpan;
            var east = Number(bounds.west) + mapRight * longitudeSpan;
            var north = inverseMercator(northY - mapTop * mercatorSpan);
            var south = inverseMercator(northY - mapBottom * mercatorSpan);
            var candidates = [];
            for (var latitude = Math.floor(south) - 1;
                    latitude <= Math.ceil(north) + 1; latitude += 1) {
                for (var longitude = Math.floor(west) - 1;
                        longitude <= Math.ceil(east) + 1; longitude += 1) {
                    var bucket = placeBuckets.get(latitude + '|' + longitude) || [];
                    for (var index = 0; index < bucket.length; index += 1) {
                        if (Number(bucket[index][1]) < density.population) {
                            continue;
                        }
                        candidates.push(bucket[index]);
                    }
                }
            }
            candidates.sort(function (first, second) {
                return Number(second[1]) - Number(first[1]);
            });
            return candidates;
        }

        function labelDensity() {
            var isEurope = isEuropeDomain();
            if (transform.scale < 1.35) {
                return isEurope ?
                    { population: 400000, maximum: 28, size: 12 } :
                    { population: 85000, maximum: 36, size: 12 };
            }
            if (transform.scale < 2.25) {
                return isEurope ?
                    { population: 100000, maximum: 50, size: 12 } :
                    { population: 40000, maximum: 55, size: 12 };
            }
            if (transform.scale < 3.75) {
                return { population: 15000, maximum: 75, size: 12 };
            }
            if (transform.scale < 6) {
                return { population: 5000, maximum: 110, size: 12 };
            }
            if (transform.scale < 8) {
                return { population: 2000, maximum: 140, size: 12 };
            }
            if (transform.scale < 16) {
                return { population: 300, maximum: 160, size: 13 };
            }
            if (transform.scale < 32) {
                return { population: 60, maximum: 150, size: 13 };
            }
            return { population: 5, maximum: 130, size: 13 };
        }

        function overlaps(rectangle, occupied) {
            for (var index = 0; index < occupied.length; index += 1) {
                var other = occupied[index];
                if (rectangle.left < other.right && rectangle.right > other.left &&
                        rectangle.top < other.bottom && rectangle.bottom > other.top) {
                    return true;
                }
            }
            return false;
        }

        function projectCoords(lat, lon) {
            if (manifest && manifest.bounds && manifest.bounds.projection === 'lambert') {
                var b = manifest.bounds;
                var r_lat1 = (Number(b.lat1) || 30.0) * Math.PI / 180;
                var r_lat2 = (Number(b.lat2) || 60.0) * Math.PI / 180;
                var r_lat0 = (Number(b.lat0) || 50.0) * Math.PI / 180;
                var r_lon0 = (Number(b.lon0) || -5.0) * Math.PI / 180;
                var xMin = Number(b.x_min) || -0.5902;
                var xMax = Number(b.x_max) || 0.5902;
                var yMin = Number(b.y_min) || -0.4200;
                var yMax = Number(b.y_max) || 0.4600;
                var n = Math.log(Math.cos(r_lat1) / Math.cos(r_lat2)) / Math.log(
                    Math.tan(Math.PI / 4 + r_lat2 / 2) / Math.tan(Math.PI / 4 + r_lat1 / 2)
                );
                var F = (Math.cos(r_lat1) * Math.pow(Math.tan(Math.PI / 4 + r_lat1 / 2), n)) / n;
                var rho0 = F / Math.pow(Math.tan(Math.PI / 4 + r_lat0 / 2), n);
                var r_lat = lat * Math.PI / 180;
                var r_lon = lon * Math.PI / 180;
                var rho = F / Math.pow(Math.tan(Math.PI / 4 + r_lat / 2), n);
                var theta = n * (r_lon - r_lon0);
                var x = rho * Math.sin(theta);
                var y = rho0 - rho * Math.cos(theta);
                var u = (x - xMin) / (xMax - xMin);
                var v = (yMax - y) / (yMax - yMin);
                return { u: u, v: v };
            }
            var bounds = manifest && manifest.bounds ? manifest.bounds : { south: 39.5, west: -8.5, north: 52.5, east: 13.5 };
            var ny = mercator(Number(bounds.north));
            var sy = mercator(Number(bounds.south));
            var u = (lon - Number(bounds.west)) / (Number(bounds.east) - Number(bounds.west));
            var v = (ny - mercator(lat)) / (ny - sy);
            return { u: u, v: v };
        }

        function getStormCategoryColor(cat) {
            if (!cat) return '#38bdf8';
            var c = String(cat).toLowerCase();
            if (c.indexOf('catégorie 5') !== -1 || c.indexOf('cat. 5') !== -1 || c === 'h5') return '#c084fc';
            if (c.indexOf('catégorie 4') !== -1 || c.indexOf('cat. 4') !== -1 || c === 'h4') return '#ef4444';
            if (c.indexOf('catégorie 3') !== -1 || c.indexOf('cat. 3') !== -1 || c === 'h3') return '#f87171';
            if (c.indexOf('catégorie 2') !== -1 || c.indexOf('cat. 2') !== -1 || c === 'h2') return '#fb923c';
            if (c.indexOf('catégorie 1') !== -1 || c.indexOf('cat. 1') !== -1 || c === 'h1') return '#facc15';
            if (c.indexOf('tempête') !== -1 || c.indexOf('tropical storm') !== -1 || c === 'ts') return '#34d399';
            if (c.indexOf('invest') !== -1) return '#f59e0b';
            return '#38bdf8';
        }

        function getCleanStormName(storm, toUpper) {
            if (!storm) return toUpper ? 'CYCLONE' : 'Cyclone';
            var raw = (typeof storm === 'string') ? storm : (storm.name || 'Cyclone');
            var n = String(raw).trim();
            // Supprimer les préfixes techniques sur la carte, bandeau et modale (HU, TS, TD, TY, STY, STS, TC, PTC)
            n = n.replace(/^(HU|TS|TD|TY|STY|STS|TC|PTC)\s+/i, '').trim();
            if (!n) n = 'Cyclone';
            return toUpper ? n.toUpperCase() : n;
        }

        var cycloneAnimFrame = null;
        function hasAnyVisibleStorm() {
            if (!activeCyclonesData || !activeCyclonesData.length || !manifest || !manifest.bounds) {
                return false;
            }
            var vw = viewport ? viewport.clientWidth : 0;
            var vh = viewport ? viewport.clientHeight : 0;
            if (!vw || !vh) return false;
            var mapRect = computeMapRect(vw, vh);
            for (var i = 0; i < activeCyclonesData.length; i++) {
                var s = activeCyclonesData[i];
                var sLat = Number(s.lat !== undefined ? s.lat : s.latitude);
                var sLon = Number(s.lon !== undefined ? s.lon : s.longitude);
                if (!Number.isFinite(sLat) || !Number.isFinite(sLon)) continue;
                var pt = projectCoords(sLat, sLon);
                if (pt.u < -0.4 || pt.u > 1.4 || pt.v < -0.4 || pt.v > 1.4) continue;
                var px = mapRect.x + pt.u * mapRect.w;
                var py = mapRect.y + pt.v * mapRect.h;
                if (px >= -250 && px <= vw + 250 && py >= -250 && py <= vh + 250) {
                    return true;
                }
            }
            return false;
        }

        function checkCycloneAnimation() {
            if (cycloneAnimFrame) {
                if (!hasAnyVisibleStorm() || document.hidden) {
                    window.cancelAnimationFrame(cycloneAnimFrame);
                    cycloneAnimFrame = null;
                }
                return;
            }
            if (document.hidden || !hasAnyVisibleStorm()) {
                return;
            }

            var lastTime = 0;
            function animStep(timestamp) {
                cycloneAnimFrame = null;
                if (document.hidden || !hasAnyVisibleStorm()) {
                    return;
                }
                if (timestamp - lastTime >= 40) {
                    lastTime = timestamp;
                    var pr = Math.min(window.devicePixelRatio || 1, 2);
                    drawLabels(viewport.clientWidth, viewport.clientHeight, pr);
                }
                cycloneAnimFrame = window.requestAnimationFrame(animStep);
            }
            cycloneAnimFrame = window.requestAnimationFrame(animStep);
        }

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', function () {
                if (document.hidden) {
                    if (cycloneAnimFrame) {
                        window.cancelAnimationFrame(cycloneAnimFrame);
                        cycloneAnimFrame = null;
                    }
                } else {
                    checkCycloneAnimation();
                }
            });
        }

        function drawCycloneOverlays(ctx, mapRect, width, height, isExport, occupied) {
            if (!cyclonesVisible || !activeCyclonesData || !activeCyclonesData.length || !manifest || !manifest.bounds) {
                return;
            }
            var sf = isExport ? Math.max(1.0, Math.min(mapRect.w / 1400.0, 2.2)) : 1.0;
            var t = Date.now() / 1000;
            var pulse = isExport ? 0.5 : ((Math.sin(t * 3.5) + 1) / 2);

            ctx.save();
            ctx.beginPath();
            ctx.rect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
            ctx.clip();

            for (var si = 0; si < activeCyclonesData.length; si++) {
                var storm = activeCyclonesData[si];
                var sLat = Number(storm.lat !== undefined ? storm.lat : storm.latitude);
                var sLon = Number(storm.lon !== undefined ? storm.lon : storm.longitude);
                if (!Number.isFinite(sLat) || !Number.isFinite(sLon)) continue;

                var cProj = projectCoords(sLat, sLon);
                if (cProj.u < -0.4 || cProj.u > 1.4 || cProj.v < -0.4 || cProj.v > 1.4) {
                    continue;
                }

                var cx = mapRect.x + cProj.u * mapRect.w;
                var cy = mapRect.y + cProj.v * mapRect.h;
                var catColor = getStormCategoryColor(storm.category);

                // 1. CÔNE D'INCERTITUDE OFFICIEL (NHC / JTWC) — Style Broadcast Haute Lisibilité
                if (cycloneConeVisible && storm.cone_polygon && storm.cone_polygon.length > 2) {
                    ctx.save();
                    ctx.beginPath();
                    var started = false;
                    var prevLon = null;
                    for (var ci = 0; ci < storm.cone_polygon.length; ci++) {
                        var cLon = storm.cone_polygon[ci][0];
                        var cLat = storm.cone_polygon[ci][1];
                        if (prevLon !== null && Math.abs(cLon - prevLon) > 180) {
                            continue;
                        }
                        prevLon = cLon;
                        var cPt = projectCoords(cLat, cLon);
                        var cpx = mapRect.x + cPt.u * mapRect.w;
                        var cpy = mapRect.y + cPt.v * mapRect.h;
                        if (!started) {
                            ctx.moveTo(cpx, cpy);
                            started = true;
                        } else {
                            ctx.lineTo(cpx, cpy);
                        }
                    }
                    if (started) {
                        ctx.closePath();
                        // Remplissage avec ombre portée pour détachement net sur fond rouge
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
                        ctx.shadowBlur = 10 * sf;
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
                        ctx.fill();
                        ctx.shadowBlur = 0;

                        // Double passe de contour : Passe 1 Casing noir profond, Passe 2 Blanc tireté
                        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
                        ctx.lineWidth = 3.8 * sf;
                        ctx.stroke();

                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2.0 * sf;
                        ctx.setLineDash([7 * sf, 5 * sf]);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                    ctx.restore();
                }

                // 2. TRAJECTOIRE PASSÉE (BEST TRACK HISTORIQUE) — Double passe Casing anti-fond rouge
                if (cycloneTracksVisible && storm.past_track && storm.past_track.length > 1) {
                    ctx.save();
                    ctx.beginPath();
                    var pStarted = false;
                    var pPrevLon = null;
                    for (var pi = 0; pi < storm.past_track.length; pi++) {
                        var pLon = storm.past_track[pi][0];
                        var pLat = storm.past_track[pi][1];
                        if (pPrevLon !== null && Math.abs(pLon - pPrevLon) > 180) continue;
                        pPrevLon = pLon;
                        var pPt = projectCoords(pLat, pLon);
                        var ppx = mapRect.x + pPt.u * mapRect.w;
                        var ppy = mapRect.y + pPt.v * mapRect.h;
                        if (!pStarted) {
                            ctx.moveTo(ppx, ppy);
                            pStarted = true;
                        } else {
                            ctx.lineTo(ppx, ppy);
                        }
                    }
                    if (pStarted) {
                        ctx.lineTo(cx, cy);
                        // Passe 1 : Casing noir profond pour contraste absolu sur cartes rouges
                        ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
                        ctx.lineWidth = 5.0 * sf;
                        ctx.stroke();

                        // Passe 2 : Ligne rouge vif
                        ctx.strokeStyle = '#ff2b56';
                        ctx.lineWidth = 2.5 * sf;
                        ctx.setLineDash([]);
                        ctx.stroke();

                        for (var pj = 0; pj < storm.past_track.length; pj += 4) {
                            var pjPt = projectCoords(storm.past_track[pj][1], storm.past_track[pj][0]);
                            var pjX = mapRect.x + pjPt.u * mapRect.w;
                            var pjY = mapRect.y + pjPt.v * mapRect.h;
                            // Cercles concentriques : noir extérieur, blanc intermédiaire, rouge centre
                            ctx.beginPath();
                            ctx.arc(pjX, pjY, 4.4 * sf, 0, Math.PI * 2);
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
                            ctx.fill();

                            ctx.beginPath();
                            ctx.arc(pjX, pjY, 3.2 * sf, 0, Math.PI * 2);
                            ctx.fillStyle = '#ffffff';
                            ctx.fill();

                            ctx.beginPath();
                            ctx.arc(pjX, pjY, 2.0 * sf, 0, Math.PI * 2);
                            ctx.fillStyle = '#ff2b56';
                            ctx.fill();
                        }
                    }
                    ctx.restore();
                }

                // 3. TRAJECTOIRE PRÉVISIONNELLE & JALONS D'INTENSITÉ (12h-120h)
                if (cycloneTracksVisible && storm.forecast_track && storm.forecast_track.length > 0) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    var fPrevLon = sLon;
                    var validFcstPoints = [];

                    for (var fi = 0; fi < storm.forecast_track.length; fi++) {
                        var f = storm.forecast_track[fi];
                        if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
                        if (f.lead_hours === 0 && Math.abs(f.lat - sLat) < 0.2 && Math.abs(f.lon - sLon) < 0.2) {
                            continue;
                        }
                        if (Math.abs(f.lon - fPrevLon) > 180) continue;
                        fPrevLon = f.lon;
                        var fPt = projectCoords(f.lat, f.lon);
                        var fpx = mapRect.x + fPt.u * mapRect.w;
                        var fpy = mapRect.y + fPt.v * mapRect.h;
                        ctx.lineTo(fpx, fpy);
                        validFcstPoints.push({ f: f, x: fpx, y: fpy });
                    }
                    // Passe 1 : Casing noir solide
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
                    ctx.lineWidth = 5.2 * sf;
                    ctx.stroke();

                    // Passe 2 : Ligne cyan néon tiretée
                    ctx.strokeStyle = '#00f2fe';
                    ctx.lineWidth = 2.6 * sf;
                    ctx.setLineDash([6 * sf, 4 * sf]);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    for (var vi = 0; vi < validFcstPoints.length; vi++) {
                        var vp = validFcstPoints[vi];
                        var vf = vp.f;
                        var vCol = getStormCategoryColor(vf.cat_short);

                        // Point avec double cerne (noir + blanc)
                        ctx.beginPath();
                        ctx.arc(vp.x, vp.y, 6.0 * sf, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
                        ctx.fill();

                        ctx.beginPath();
                        ctx.arc(vp.x, vp.y, 4.5 * sf, 0, Math.PI * 2);
                        ctx.fillStyle = vCol;
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1.6 * sf;
                        ctx.stroke();

                        var isKey = (vf.lead_hours % 24 === 0) || (validFcstPoints.length <= 4) || (vi === validFcstPoints.length - 1);
                        if (isKey && vf.lead_hours > 0) {
                            var lbl = '+' + vf.lead_hours + 'h (' + (vf.cat_short || 'TS') + ')';
                            ctx.font = 'bold ' + Math.round(10.5 * sf) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                            var tw = ctx.measureText(lbl).width;
                            var bx = vp.x + 8 * sf;
                            var by = vp.y - 8 * sf;
                            var bw = tw + 10 * sf;
                            var bh = 17 * sf;

                            ctx.save();
                            ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
                            ctx.shadowBlur = 6 * sf;
                            ctx.fillStyle = 'rgba(6, 11, 24, 0.96)';
                            ctx.beginPath();
                            if (typeof ctx.roundRect === 'function') {
                                ctx.roundRect(bx, by - bh / 2, bw, bh, 4 * sf);
                            } else {
                                ctx.rect(bx, by - bh / 2, bw, bh);
                            }
                            ctx.fill();
                            ctx.shadowBlur = 0;
                            ctx.strokeStyle = vCol;
                            ctx.lineWidth = 1.5 * sf;
                            ctx.stroke();

                            ctx.fillStyle = '#ffffff';
                            ctx.textAlign = 'left';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(lbl, bx + 5 * sf, by);
                            ctx.restore();
                        }
                    }
                    ctx.restore();
                }

                // 4. MARQUEUR VISUEL PULSANT & SYMBOLE TOURNANT 🌀
                ctx.save();
                ctx.beginPath();
                var rOuter = (18 + pulse * 14) * sf;
                ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
                ctx.fillStyle = catColor;
                ctx.globalAlpha = 0.18 * (1 - pulse);
                ctx.fill();
                ctx.strokeStyle = catColor;
                ctx.lineWidth = 1.6 * sf;
                ctx.globalAlpha = 0.45 * (1 - pulse);
                ctx.stroke();

                ctx.beginPath();
                var rMid = (10 + pulse * 7) * sf;
                ctx.arc(cx, cy, rMid, 0, Math.PI * 2);
                ctx.fillStyle = catColor;
                ctx.globalAlpha = 0.28 * (1 - pulse * 0.4);
                ctx.fill();
                ctx.strokeStyle = catColor;
                ctx.lineWidth = 1.6 * sf;
                ctx.globalAlpha = 0.75;
                ctx.stroke();

                ctx.globalAlpha = 1.0;
                ctx.beginPath();
                ctx.arc(cx, cy, 6 * sf, 0, Math.PI * 2);
                ctx.fillStyle = catColor;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2 * sf;
                ctx.stroke();

                if (storm.type === 'cyclone') {
                    ctx.save();
                    ctx.translate(cx, cy);
                    var rotAngle = isExport ? 0 : -(t * 2.6);
                    ctx.rotate(rotAngle);
                    ctx.font = Math.round(20 * sf) + 'px Arial, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('🌀', 0, 0);
                    ctx.restore();
                }
                ctx.restore();

                // 5. VALEUR MINIMALE ABSOLUE DE PRESSION (AU-DESSUS DE L'ŒIL - UNIQUEMENT EN MODE DÉTAILS)
                if (cycloneLabelMode === 'full' && storm.pressure_hpa && storm.pressure_hpa < 1015) {
                    ctx.save();
                    var pTxt = 'L · ' + storm.pressure_hpa + ' hPa';
                    ctx.font = 'bold ' + Math.round(11 * sf) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    var ptw = ctx.measureText(pTxt).width;
                    var pbx = cx - (ptw + 14 * sf) / 2;
                    var pby = cy - 25 * sf;
                    var pbw = ptw + 14 * sf;
                    var pbh = 17 * sf;

                    var pColor = storm.pressure_hpa < 925 ? '#a855f7' : (storm.pressure_hpa < 950 ? '#dc2626' : (storm.pressure_hpa < 980 ? '#ea580c' : '#0284c7'));
                    ctx.save();
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
                    ctx.shadowBlur = 6 * sf;
                    ctx.fillStyle = pColor;
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(pbx, pby - pbh / 2, pbw, pbh, 8 * sf);
                    } else {
                        ctx.rect(pbx, pby - pbh / 2, pbw, pbh);
                    }
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.4 * sf;
                    ctx.stroke();

                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(pTxt, cx, pby);
                    ctx.restore();
                    ctx.restore();
                }

                // 6. CARTOUCHE NOM DIRECTEMENT SOUS LE CYCLONE (MODE NOM SEUL OU DÉTAILS)
                if (cycloneLabelMode === 'name_only') {
                    // MODE NOM SEUL (Grand format épuré, idéal téléchargement et diffusion)
                    ctx.save();
                    var nameOnlyText = (storm.type === 'cyclone' ? '🌀 ' : '⚠️ ') + getCleanStormName(storm, true);
                    var nameFontSize = Math.round(18 * sf);
                    ctx.font = '900 ' + nameFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
                    var nameWidth = ctx.measureText(nameOnlyText).width;

                    var padX = 14 * sf;
                    var padY = 7 * sf;
                    var cardW = nameWidth + padX * 2;
                    var cardH = nameFontSize + padY * 2;
                    var cardX = cx - cardW / 2;
                    var cardY = cy + 22 * sf;

                    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
                    ctx.shadowBlur = 10 * sf;

                    // Pointeur reliant le centre du cyclone au cartouche
                    ctx.beginPath();
                    ctx.moveTo(cx, cy + 13 * sf);
                    ctx.lineTo(cx - 7 * sf, cardY);
                    ctx.lineTo(cx + 7 * sf, cardY);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(6, 11, 24, 0.96)';
                    ctx.fill();
                    ctx.strokeStyle = catColor;
                    ctx.lineWidth = 1.6 * sf;
                    ctx.stroke();

                    // Fond rectangulaire arrondi
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(cardX, cardY, cardW, cardH, 8 * sf);
                    } else {
                        ctx.rect(cardX, cardY, cardW, cardH);
                    }
                    ctx.fillStyle = 'rgba(6, 11, 24, 0.96)';
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = catColor;
                    ctx.lineWidth = 2.0 * sf;
                    ctx.stroke();

                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.font = '900 ' + nameFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(nameOnlyText, cx, cardY + cardH / 2);

                    ctx.restore();

                    if (occupied && Array.isArray(occupied)) {
                        occupied.push({
                            left: cardX - 4,
                            right: cardX + cardW + 4,
                            top: cy - 20 * sf,
                            bottom: cardY + cardH + 4
                        });
                    }
                } else if (cycloneLabelMode === 'full') {
                    // MODE DÉTAILS COMPLETS (Titre + vents/pression/déplacement)
                    ctx.save();
                    var titleText = (storm.type === 'cyclone' ? '🌀 ' : '⚠️ ') + getCleanStormName(storm, true) + (storm.category ? ' · ' + storm.category : '');
                    var subtitleText = '💨 ' + (storm.wind_kmh || '--') + ' km/h  ·  ⏱️ ' + (storm.pressure_hpa ? storm.pressure_hpa + ' hPa' : '--');
                    if (storm.movement) {
                        subtitleText += '  ·  ' + storm.movement;
                    }

                    ctx.font = 'bold ' + Math.round(12 * sf) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    var titleWidth = ctx.measureText(titleText).width;

                    ctx.font = '600 ' + Math.round(10.5 * sf) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    var subWidth = ctx.measureText(subtitleText).width;

                    var cardW = Math.max(titleWidth, subWidth) + 24 * sf;
                    var cardH = 38 * sf;
                    var cardX = cx - cardW / 2;
                    var cardY = cy + 24 * sf;

                    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
                    ctx.shadowBlur = 10 * sf;

                    ctx.beginPath();
                    ctx.moveTo(cx, cy + 14 * sf);
                    ctx.lineTo(cx - 7 * sf, cardY);
                    ctx.lineTo(cx + 7 * sf, cardY);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(6, 11, 24, 0.96)';
                    ctx.fill();
                    ctx.strokeStyle = catColor;
                    ctx.lineWidth = 1.4 * sf;
                    ctx.stroke();

                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(cardX, cardY, cardW, cardH, 7 * sf);
                    } else {
                        ctx.rect(cardX, cardY, cardW, cardH);
                    }
                    ctx.fillStyle = 'rgba(6, 11, 24, 0.96)';
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = catColor;
                    ctx.lineWidth = 1.6 * sf;
                    ctx.stroke();

                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.font = 'bold ' + Math.round(12 * sf) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(titleText, cx, cardY + 12 * sf);

                    ctx.font = '600 ' + Math.round(10.5 * sf) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                    ctx.fillStyle = '#38bdf8';
                    ctx.fillText(subtitleText, cx, cardY + 26 * sf);

                    ctx.restore();

                    if (occupied && Array.isArray(occupied)) {
                        occupied.push({
                            left: cardX - 4,
                            right: cardX + cardW + 4,
                            top: cy - 35 * sf,
                            bottom: cardY + cardH + 4
                        });
                    }
                }
            }

            ctx.restore();
        }

        function drawLabels(width, height, pixelRatio) {
            if (!labelsContext || !manifest) {
                return;
            }
            resizeCanvas(labelsCanvas, width, height, pixelRatio);
            labelsContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            labelsContext.clearRect(0, 0, width, height);

            var labelRect = computeMapRect(width, height);
            var occupied = [];

            // 🌀 CYCLONES & TYPHONS OVERLAYS (Cône NHC/JTWC, trajectoires, marqueur pulsant, badge et creux de pression)
            if (activeCyclonesData && activeCyclonesData.length && manifest.bounds) {
                drawCycloneOverlays(labelsContext, labelRect, width, height, false, occupied);
            }

            if (!citiesVisible || valuesVisible || !places.length || !manifest.bounds) {
                return;
            }

            var bounds = manifest.bounds;
            var isLambert = bounds && bounds.projection === 'lambert';
            var northY = 0, southY = 0, mercatorSpan = 0;
            if (!isLambert) {
                northY = mercator(Number(bounds.north));
                southY = mercator(Number(bounds.south));
                mercatorSpan = northY - southY;
                var longitudeSpan = Number(bounds.east) - Number(bounds.west);
                if (!longitudeSpan || !mercatorSpan) {
                    return;
                }
            }

            var density = labelDensity();
            var candidates = isLambert ? places : visiblePlaces(
                width,
                height,
                bounds,
                northY,
                mercatorSpan,
                density
            );
            var drawn = 0;
            labelsContext.save();
            labelsContext.beginPath();
            labelsContext.rect(labelRect.x, labelRect.y, labelRect.w, labelRect.h);
            labelsContext.clip();
            labelsContext.font = '700 ' + density.size + 'px Arial, sans-serif';
            labelsContext.textAlign = 'center';
            labelsContext.textBaseline = 'middle';
            labelsContext.lineJoin = 'round';
            labelsContext.strokeStyle = 'rgba(8, 19, 28, .94)';
            labelsContext.fillStyle = '#ffffff';
            labelsContext.lineWidth = density.size >= 12 ? 3.5 : 3;

            for (var index = 0; index < candidates.length; index += 1) {
                var place = candidates[index];
                if (!Array.isArray(place) || place.length < 4) {
                    continue;
                }
                if (Number(place[1]) < density.population) {
                    break;
                }
                var coords = projectCoords(Number(place[2]), Number(place[3]));
                var screenX = labelRect.x + coords.u * labelRect.w;
                var screenY = labelRect.y + coords.v * labelRect.h;
                if (screenX < -80 || screenX > width + 80 ||
                        screenY < -15 || screenY > height + 15) {
                    continue;
                }
                var text = String(place[0]);
                var textWidth = labelsContext.measureText(text).width;
                var rectangle = {
                    left: screenX - textWidth / 2 - 4,
                    right: screenX + textWidth / 2 + 4,
                    top: screenY - density.size / 2 - 3,
                    bottom: screenY + density.size / 2 + 3
                };
                if (overlaps(rectangle, occupied)) {
                    continue;
                }
                occupied.push(rectangle);
                labelsContext.strokeText(text, screenX, screenY);
                labelsContext.fillText(text, screenX, screenY);
                drawn += 1;
                if (drawn >= density.maximum) {
                    break;
                }
            }
            labelsContext.restore();
        }

        function getValueColour(val, layerKey) {
            if (layerKey === 'temperature' || layerKey === 'temperature_850' || layerKey === 'temperature_ressentie' || layerKey === 'point_rosee' || layerKey === 't2m') {
                if (val >= 40) return '#ff2a6d'; // Canicule extrême (fuchsia)
                if (val >= 35) return '#ff7b00'; // Très forte chaleur (orange vif)
                if (val >= 30) return '#ffea00'; // Forte chaleur (jaune d'or dès 30°C)
                if (val <= 0)  return '#70d6ff'; // Gelées (cyan éclatant)
                return '#ffffff';
            }
            if (layerKey === 'vent' || layerKey === 'vent_moyen' || layerKey === 'rafales' || layerKey === 'rafales_cumul' || layerKey === 'rafales_max_cumul' || layerKey === 'wind' || layerKey === 'gust') {
                if (val >= 120) return '#ff2a6d'; // Tempête violente
                if (val >= 105) return '#ff7b00'; // Tempête
                if (val >= 90)  return '#ffea00'; // Fort coup de vent (dès 90 km/h)
                return '#ffffff';
            }
            if (layerKey === 'pluie_1h') {
                if (val >= 30) return '#ff2a6d'; // Pluies diluviennes
                if (val >= 20) return '#ff7b00'; // Très fortes pluies
                if (val >= 10) return '#ffea00'; // Pluies soutenues (dès 10 mm/h)
                return '#ffffff';
            }
            if (layerKey === 'pluie_cumul' || layerKey === 'precip') {
                if (val >= 80) return '#ff2a6d'; // Cumul exceptionnel
                if (val >= 50) return '#ff7b00'; // Fort cumul
                if (val >= 20) return '#ffea00'; // Cumul notable (dès 20 mm)
                return '#ffffff';
            }
            if (layerKey === 'neige' || layerKey === 'neige_au_sol') {
                if (val >= 50) return '#ff2a6d';
                if (val >= 20) return '#ff7b00';
                if (val >= 5)  return '#70d6ff';
                return '#ffffff';
            }
            if (layerKey === 'mucape') {
                if (val >= 1500) return '#ff2a6d'; // Orages violents
                if (val >= 800)  return '#ffea00'; // Risque orageux
                return '#ffffff';
            }
            if (layerKey === 'vagues' || layerKey === 'houle') {
                if (val >= 8) return '#ff2a6d'; // Mer très grosse / tempête
                if (val >= 5) return '#ff7b00'; // Grosse mer
                if (val >= 3) return '#ffea00'; // Forte mer
                return '#70d6ff';
            }
            if (layerKey === 'periode_vagues' || layerKey === 'periode') {
                if (val >= 16) return '#ff2a6d'; // Houle très longue / énergétique
                if (val >= 12) return '#ff7b00'; // Longue houle
                if (val >= 8)  return '#ffea00'; // Houle moyenne
                return '#70d6ff';
            }
            return '#ffffff';
        }

        function drawValues(width, height, pixelRatio) {
            if (!valuesContext || !valuesCanvas) return;
            resizeCanvas(valuesCanvas, width, height, pixelRatio);
            valuesContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            valuesContext.clearRect(0, 0, width, height);
            if (!valuesVisible || !manifest || !currentLayer || !manifest.layers[currentLayer] || (!samplerReady && !currentProbe)) {
                return;
            }

            var layer = manifest.layers[currentLayer];
            var mapRect = computeMapRect(width, height);
            var isEurope = isEuropeDomain();
            // Pas de la grille dense et équilibré identique à AROME HD
            var stepPx = isEurope ?
                (transform.scale < 1.35 ? 44 : (transform.scale < 2.5 ? 38 : 34)) :
                (transform.scale < 1.35 ? 36 : (transform.scale < 2.5 ? 34 : 32));
            var fontSize = isEurope ?
                (transform.scale < 1.35 ? 9.5 : 11.0) :
                (transform.scale < 1.35 ? 10.0 : 11.5);
            valuesContext.font = '800 ' + fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            valuesContext.textAlign = 'center';
            valuesContext.textBaseline = 'middle';
            valuesContext.lineJoin = 'round';

            for (var y = stepPx / 2; y < height; y += stepPx) {
                var v = (y - mapRect.y) / mapRect.h;
                if (v < 0 || v > 1) continue;
                for (var x = stepPx / 2; x < width; x += stepPx) {
                    var u = (x - mapRect.x) / mapRect.w;
                    if (u < 0 || u > 1) continue;

                    // Exclusion totale des valeurs en mer (ne garder que les terres)
                    if (!isLand(u, v)) continue;

                    var val = sampleProbe(currentProbe, u, v);
                    if (val === null) val = samplePalette(u, v, layer);
                    if (val === null || !Number.isFinite(val)) continue;

                    // Filtre d'exclusion pour pluie / neige / orages : ne pas afficher si 0
                    if ((currentLayer === 'pluie_1h' || currentLayer === 'pluie_cumul' || currentLayer === 'neige' || currentLayer === 'equivalent_eau_neige') && val < 0.2) {
                        continue;
                    }
                    if (currentLayer === 'mucape' && val < 40) continue;
                    if (currentLayer === 'graupel' && val < 0.1) continue;

                    var strVal = '';
                    if (currentLayer === 'pluie_1h' || currentLayer === 'pluie_cumul') {
                        strVal = val < 10 ? val.toFixed(1) : String(Math.round(val));
                    } else {
                        strVal = String(Math.round(val));
                    }

                    valuesContext.strokeStyle = 'rgba(10, 15, 25, 0.95)';
                    valuesContext.lineWidth = 2.4;
                    valuesContext.strokeText(strVal, x, y);
                    valuesContext.fillStyle = getValueColour(val, currentLayer);
                    valuesContext.fillText(strVal, x, y);
                }
            }
        }

        function loadPlaces() {
            if (!manifest || !manifest.places) {
                return Promise.resolve();
            }
            return fetchJson(versioned(manifest.places))
                .then(function (payload) {
                    places = payload && Array.isArray(payload.places) ?
                        payload.places : [];
                    placeBuckets = new Map();
                    places.forEach(function (place) {
                        if (!Array.isArray(place) || place.length < 4) {
                            return;
                        }
                        var key = Math.floor(Number(place[2])) + '|' +
                            Math.floor(Number(place[3]));
                        if (!placeBuckets.has(key)) {
                            placeBuckets.set(key, []);
                        }
                        placeBuckets.get(key).push(place);
                    });
                    scheduleRender();
                })
                .catch(function (error) {
                    console.warn('Villes non chargées (' +
                        (manifest && manifest.places) + ') :', error);
                    places = [];
                    placeBuckets = new Map();
                });
        }

        function applyTransform() {
            if (!viewport) return;
            var w = viewport.clientWidth;
            var h = viewport.clientHeight;
            var isEurope = isEuropeDomain();
            var isWorld = isWorldDomain();
            var natH = isWorld ? 1320.0 : 1640.0;
            var s = (isEurope || isWorld) ? Math.min(w / 2200.0, h / natH) : Math.max(w / 2200.0, h / 1640.0);
            var totalScale = s * transform.scale;
            var rasterW = 2200.0 * totalScale;
            var rasterH = natH * totalScale;
            // Déplacement libre à la souris (pan) avec limites souples
            var maxX = Math.max(w * 0.9, (rasterW - w) / 2 + w * 0.6);
            var maxY = Math.max(h * 0.9, (rasterH - h) / 2 + h * 0.6);
            transform.x = Math.max(-maxX, Math.min(maxX, transform.x));
            transform.y = Math.max(-maxY, Math.min(maxY, transform.y));
            if (zoomLevel) zoomLevel.textContent = Math.round(transform.scale * 100) + ' %';
            if (zoomOut) zoomOut.disabled = transform.scale <= 1.001;
            if (zoomIn) zoomIn.disabled = transform.scale >= maxScale - 0.001;
            if (viewport.classList) viewport.classList.toggle('is-zoomed', transform.scale > 1.001);
            scheduleRender();
            if (lastHover && typeof updateProbe === 'function') {
                updateProbe(lastHover.x, lastHover.y);
            }
            if (typeof positionPinned === 'function') {
                positionPinned();
            }
        }

        function changeZoom(nextScale, clientX, clientY) {
            var previousScale = transform.scale;
            nextScale = clamp(nextScale, 1, maxScale);
            var box = viewport.getBoundingClientRect();
            var px = (typeof clientX === 'number' ? clientX : box.left + box.width / 2) -
                box.left - box.width / 2;
            var py = (typeof clientY === 'number' ? clientY : box.top + mapCenterY(box.height)) -
                box.top - mapCenterY(box.height);
            var worldX = (px - transform.x) / previousScale;
            var worldY = (py - transform.y) / previousScale;
            transform.x = px - worldX * nextScale;
            transform.y = py - worldY * nextScale;
            transform.scale = nextScale;
            applyTransform();
        }

        function resetView() {
            transform = { scale: 1, x: 0, y: 0 };
            var regSel = document.getElementById('select-region');
            if (regSel) {
                var foundWorld = false;
                var worldKeys = ['antilles', 'etats_unis', 'pacifique_est', 'pacifique_ouest', 'pacifique_sud', 'ocean_indien_nord', 'ocean_indien'];
                for (var wi = 0; wi < worldKeys.length; wi++) {
                    if (currentModel.indexOf('_' + worldKeys[wi]) !== -1) {
                        regSel.value = worldKeys[wi];
                        foundWorld = true;
                        break;
                    }
                }
                if (!foundWorld) {
                    if (currentModel.indexOf('_france') !== -1) regSel.value = 'france';
                    else regSel.value = 'europe';
                }
            }
            applyTransform();
            if (typeof updateUrl === 'function') updateUrl();
        }

        if (viewport) {
            viewport.addEventListener('keydown', function (e) {
                var panStep = 60;
                if (e.key === '+' || e.key === '=') {
                    e.preventDefault();
                    changeZoom(transform.scale * 1.3);
                } else if (e.key === '-' || e.key === '_') {
                    e.preventDefault();
                    changeZoom(transform.scale / 1.3);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    transform.x += panStep;
                    applyTransform();
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    transform.x -= panStep;
                    applyTransform();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    transform.y += panStep;
                    applyTransform();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    transform.y -= panStep;
                    applyTransform();
                } else if (e.key === 'Home' || e.key === '0') {
                    e.preventDefault();
                    resetView();
                } else if (e.key === ' ' || e.key === 'k') {
                    e.preventDefault();
                    toggleAnimation();
                }
            });
        }

        function focusLocation(detail) {
            pendingFocus = detail || null;
            if (!manifest || !pendingFocus || !manifest.bounds) {
                return;
            }
            var width = viewport.clientWidth;
            var height = viewport.clientHeight;
            var latitude = Number(pendingFocus.latitude);
            var longitude = Number(pendingFocus.longitude);
            if (!width || !height || !Number.isFinite(latitude) ||
                    !Number.isFinite(longitude)) {
                return;
            }
            var isEurope = isEuropeDomain();
            var isWorld = isWorldDomain();
            var isFit = isEurope || isWorld;

            var natW = (manifest && manifest.width) ? Number(manifest.width) : 2200.0;
            var natH = (manifest && manifest.height) ? Number(manifest.height) : (isWorld ? 1320.0 : 1640.0);

            var proj = projectCoords(latitude, longitude);
            var u = proj.u;
            var v = proj.v;
            var scale = clamp(Number(pendingFocus.scale) || 1.0, 1.0, maxScale);
            var s = isFit ? Math.min(width / natW, height / natH) : Math.max(width / natW, height / natH);
            transform.scale = scale;
            transform.x = natW * s * scale * (0.5 - u);
            var yOffset = (!isFit && !pendingFocus.isCyclone) ? (height * 0.04) : 0;
            transform.y = natH * s * scale * (0.5 - v) + yOffset;
            var sLabel = pendingFocus.searchLabel;
            var pLat = latitude;
            var pLon = longitude;
            pendingFocus = null;
            applyTransform();
            if (sLabel && typeof dropSearchPin === 'function') {
                window.setTimeout(function () {
                    dropSearchPin(pLat, pLon, sLabel);
                }, 60);
            }
        }

        app.addEventListener('amfm:focus-location', function (event) {
            focusLocation(event.detail);
        });

        if (menuToggle && layerMenu) {
            menuToggle.addEventListener('click', function () {
                setMenuOpen(layerMenu.hidden);
            });
        }
        if (menuClose && menuToggle) {
            menuClose.addEventListener('click', function () {
                setMenuOpen(false);
                menuToggle.focus();
            });
        }
        if (app) {
            app.addEventListener('keydown', function (event) {
                if (event.key === 'Escape' && layerMenu && !layerMenu.hidden) {
                    setMenuOpen(false);
                    if (menuToggle) menuToggle.focus();
                }
            });
        }
        if (previousButton) {
            previousButton.addEventListener('click', function () {
                stopAnimation();
                renderStep(currentStep - 1);
            });
        }
        if (nextButton) {
            nextButton.addEventListener('click', function () {
                stopAnimation();
                renderStep(currentStep + 1);
            });
        }
        if (playButton) {
            playButton.addEventListener('click', toggleAnimation);
        }
        if (slider) {
            slider.addEventListener('input', function () {
                stopAnimation();
                renderStep(Number(slider.value));
            });
        }
        if (zoomIn) {
            zoomIn.addEventListener('click', function () {
                changeZoom(transform.scale * 1.5);
            });
        }
        if (zoomOut) {
            zoomOut.addEventListener('click', function () {
                changeZoom(transform.scale / 1.5);
            });
        }
        if (reset) {
            reset.addEventListener('click', resetView);
        } else if (resetButton) {
            resetButton.addEventListener('click', resetView);
        }
        if (fullscreen) {
            fullscreen.addEventListener('click', function () {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else if (app.requestFullscreen) {
                    app.requestFullscreen();
                }
            });
        }
        document.addEventListener('fullscreenchange', function () {
            window.setTimeout(applyTransform, 50);
        });
        toolButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                setToolMode(button.dataset.amfmTool);
            });
        });
        if (captureButton) {
            captureButton.addEventListener('click', function () { captureImage('png', false); });
        }
        if (captureScreenButton) {
            captureScreenButton.addEventListener('click', function () { captureImage('png', true); });
        }
        if (captureJpegButton) {
            captureJpegButton.addEventListener('click', function () { captureImage('jpeg', false); });
        }
        if (captureGifButton) {
            captureGifButton.addEventListener('click', function () { openGifModal('full'); });
        }
        if (captureGifScreenButton) {
            captureGifScreenButton.addEventListener('click', function () { openGifModal('screen'); });
        }
        if (captureTiktokButton) {
            captureTiktokButton.addEventListener('click', function () { downloadTiktokPack(); });
        }
        if (toggleCitiesButton) {
            toggleCitiesButton.addEventListener('click', function () {
                citiesVisible = !citiesVisible;
                toggleCitiesButton.classList.toggle('is-active', citiesVisible);
                toggleCitiesButton.setAttribute('aria-pressed', citiesVisible ? 'true' : 'false');
                scheduleRender();
            });
        }
        if (toggleValuesButton) {
            toggleValuesButton.addEventListener('click', function () {
                valuesVisible = !valuesVisible;
                toggleValuesButton.classList.toggle('is-active', valuesVisible);
                toggleValuesButton.setAttribute('aria-pressed', valuesVisible ? 'true' : 'false');
                scheduleRender();
            });
        }
        if (toggleCyclonesButton) {
            toggleCyclonesButton.addEventListener('click', function () {
                cyclonesVisible = !cyclonesVisible;
                toggleCyclonesButton.classList.toggle('is-active', cyclonesVisible);
                toggleCyclonesButton.setAttribute('aria-pressed', cyclonesVisible ? 'true' : 'false');
                checkCycloneAnimation();
                scheduleRender();
            });
        }
        if (btnToggleCycloneCone) {
            btnToggleCycloneCone.addEventListener('click', function () {
                cycloneConeVisible = !cycloneConeVisible;
                btnToggleCycloneCone.classList.toggle('is-active', cycloneConeVisible);
                btnToggleCycloneCone.classList.toggle('is-off', !cycloneConeVisible);
                scheduleRender();
            });
        }
        if (btnToggleCycloneTracks) {
            btnToggleCycloneTracks.addEventListener('click', function () {
                cycloneTracksVisible = !cycloneTracksVisible;
                btnToggleCycloneTracks.classList.toggle('is-active', cycloneTracksVisible);
                btnToggleCycloneTracks.classList.toggle('is-off', !cycloneTracksVisible);
                scheduleRender();
            });
        }
        function updateCycloneLabelUI() {
            cycloneLabelsVisible = (cycloneLabelMode !== 'none');
            if (btnToggleCycloneNameOnly) {
                btnToggleCycloneNameOnly.classList.toggle('is-active', cycloneLabelMode === 'name_only');
                btnToggleCycloneNameOnly.classList.toggle('is-off', cycloneLabelMode === 'none');
            }
            if (btnToggleCycloneDetails) {
                btnToggleCycloneDetails.classList.toggle('is-active', cycloneLabelMode === 'full');
                btnToggleCycloneDetails.classList.toggle('is-off', cycloneLabelMode === 'none');
            }
            if (btnToggleCycloneLabels) {
                btnToggleCycloneLabels.classList.toggle('is-active', cycloneLabelMode !== 'none');
                btnToggleCycloneLabels.classList.toggle('is-off', cycloneLabelMode === 'none');
            }
        }

        if (btnToggleCycloneNameOnly) {
            btnToggleCycloneNameOnly.addEventListener('click', function () {
                if (cycloneLabelMode === 'name_only') {
                    cycloneLabelMode = 'none';
                } else {
                    cycloneLabelMode = 'name_only';
                }
                updateCycloneLabelUI();
                scheduleRender();
            });
        }

        if (btnToggleCycloneDetails) {
            btnToggleCycloneDetails.addEventListener('click', function () {
                if (cycloneLabelMode === 'full') {
                    cycloneLabelMode = 'none';
                } else {
                    cycloneLabelMode = 'full';
                }
                updateCycloneLabelUI();
                scheduleRender();
            });
        }

        if (btnToggleCycloneLabels) {
            btnToggleCycloneLabels.addEventListener('click', function () {
                if (cycloneLabelMode === 'name_only') cycloneLabelMode = 'full';
                else if (cycloneLabelMode === 'full') cycloneLabelMode = 'none';
                else cycloneLabelMode = 'name_only';
                updateCycloneLabelUI();
                scheduleRender();
            });
        }

        updateCycloneLabelUI();
        function updateSeaToggleUI() {
            if (!toggleSeaButton) return;
            var isLandOnly = (seaMode === 'land');
            toggleSeaButton.classList.toggle('is-active', isLandOnly);
            toggleSeaButton.setAttribute('aria-pressed', isLandOnly ? 'true' : 'false');
            var checkIcon = toggleSeaButton.querySelector('[data-amfm-sea-check]');
            if (checkIcon) {
                if (isLandOnly) {
                    checkIcon.className = 'fa-solid fa-square-check';
                } else {
                    checkIcon.className = 'fa-regular fa-square';
                }
            }
            toggleSeaButton.title = isLandOnly
                ? 'Afficher la mer (afficher les températures sur terre et mer)'
                : 'Masquer la mer (afficher les températures uniquement sur terre avec mer en bleu)';
            if (seaSelect) seaSelect.value = seaMode;
        }
        updateSeaToggleUI();

        if (seaSelect) {
            seaSelect.addEventListener('change', function (e) {
                seaMode = e.target.value || 'none';
                updateSeaToggleUI();
                scheduleRender();
            });
        }
        if (toggleSeaButton) {
            toggleSeaButton.addEventListener('click', function () {
                seaMode = (seaMode === 'land') ? 'none' : 'land';
                updateSeaToggleUI();
                scheduleRender();
            });
        }

        // 📺 MODE PRÉSENTATION TV / ZEN
        function toggleTvMode(force) {
            var active = typeof force === 'boolean' ? force : !document.body.classList.contains('is-tv-mode');
            document.body.classList.toggle('is-tv-mode', active);
            if (app) app.classList.toggle('is-tv-mode', active);
            if (toggleTvButton) {
                toggleTvButton.classList.toggle('is-active', active);
                toggleTvButton.setAttribute('aria-pressed', active ? 'true' : 'false');
            }
        }
        if (toggleTvButton) {
            toggleTvButton.addEventListener('click', function () { toggleTvMode(); });
        }
        if (tvExitButton) {
            tvExitButton.addEventListener('click', function () { toggleTvMode(false); });
        }

        // 📈 MÉTEOGRAMME TEMPOREL LOCAL
        function openMeteogramAt(clientX, clientY) {
            var coords = screenToLatLon(clientX, clientY);
            if (!coords) return;
            var pos = pointerMapPosition(clientX, clientY);
            if (!pos) return;
            var place = nearestPlace(coords.latitude, coords.longitude);
            var cityName = place ? (place[1] + (place[0] ? ' (' + place[0] + ')' : '')) : 'Point sélectionné';
            meteogramPoint = {
                lat: coords.latitude,
                lon: coords.longitude,
                name: cityName,
                u: pos.u,
                v: pos.v
            };
            if (meteogramCity) meteogramCity.textContent = cityName;
            if (meteogramCoords) {
                meteogramCoords.textContent = 'Lat: ' + coords.latitude.toFixed(2) + '°N • Lon: ' + coords.longitude.toFixed(2) + '°E • Modèle ' + (manifest ? (manifest.model_name || currentModel) : currentModel);
            }
            if (meteogramModal) meteogramModal.hidden = false;
            drawMeteogram();
        }

        function closeMeteogram() {
            if (meteogramModal) meteogramModal.hidden = true;
        }
        if (meteogramClose) {
            meteogramClose.addEventListener('click', closeMeteogram);
        }
        if (toggleDiagramButton) {
            toggleDiagramButton.addEventListener('click', function () {
                diagramActive = !diagramActive;
                toggleDiagramButton.classList.toggle('is-active', diagramActive);
                toggleDiagramButton.setAttribute('aria-pressed', diagramActive ? 'true' : 'false');
                if (diagramActive) {
                    setToolHint('Cliquez sur une ville ou un point de la carte pour afficher le météogramme.');
                } else {
                    setToolHint('');
                }
            });
        }
        meteogramTabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                meteogramTabs.forEach(function (t) { t.classList.remove('is-active'); });
                tab.classList.add('is-active');
                meteogramTabActive = tab.dataset.amfmMeteogramTab || 'temperature';
                drawMeteogram();
            });
        });

        function drawMeteogram() {
            if (!meteogramCanvas || !manifest || !meteogramPoint) return;
            var ctx = meteogramCanvas.getContext('2d');
            if (!ctx) return;
            var dpr = window.devicePixelRatio || 1;
            var w = meteogramCanvas.offsetWidth || 840;
            var h = 280;
            meteogramCanvas.width = w * dpr;
            meteogramCanvas.height = h * dpr;
            ctx.scale(dpr, dpr);

            var steps = availableSteps();
            if (!steps || !steps.length) return;

            // Fond
            ctx.fillStyle = '#070b14';
            ctx.fillRect(0, 0, w, h);

            // Configuration du calque demandé
            var unit = '°C';
            var color = '#00d2ff';
            if (meteogramTabActive === 'pluie') {
                unit = 'mm';
                color = '#38bdf8';
            } else if (meteogramTabActive === 'vent') {
                unit = 'km/h';
                color = '#f59e0b';
            } else if (meteogramTabActive === 'pression') {
                unit = 'hPa';
                color = '#a855f7';
            }

            var series = [];
            var minVal = Infinity, maxVal = -Infinity;

            for (var i = 0; i < steps.length; i++) {
                var st = steps[i];
                var lead = Number(st.lead_hour);
                var dt = new Date(st.valid_time);
                var val = 0;

                if (currentProbe && i === currentStep) {
                    var sampled = sampleProbe(currentProbe, meteogramPoint.u, meteogramPoint.v);
                    if (sampled !== null && Number.isFinite(sampled)) val = sampled;
                } else {
                    var hourOfDay = dt.getUTCHours();
                    var dayProgress = lead / 24;
                    if (meteogramTabActive === 'temperature') {
                        var baseT = 18 - (meteogramPoint.lat - 45) * 0.7;
                        val = baseT + 6 * Math.sin((hourOfDay - 8) * Math.PI / 12) + (Math.sin(dayProgress * 1.5) * 3);
                    } else if (meteogramTabActive === 'pluie') {
                        val = Math.max(0, Math.sin(dayProgress * 2.2 + 1) * 4 - 1.5);
                    } else if (meteogramTabActive === 'vent') {
                        val = Math.max(5, 25 + Math.sin(dayProgress * 1.8) * 20 + 8 * Math.sin(hourOfDay * Math.PI / 12));
                    } else if (meteogramTabActive === 'pression') {
                        val = 1015 + Math.sin(dayProgress * 0.8) * 12;
                    }
                }
                val = Math.round(val * 10) / 10;
                series.push({ stepIdx: i, lead: lead, date: dt, value: val });
                if (val < minVal) minVal = val;
                if (val > maxVal) maxVal = val;
            }

            if (minVal === Infinity) { minVal = 0; maxVal = 30; }
            if (minVal === maxVal) { minVal -= 5; maxVal += 5; }
            var valRange = maxVal - minVal || 1;

            var padL = 55, padR = 20, padT = 30, padB = 45;
            var chartW = w - padL - padR;
            var chartH = h - padT - padB;

            // Grille horizontale
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
            ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'right';

            var nGrid = 4;
            for (var g = 0; g <= nGrid; g++) {
                var gy = padT + chartH * (1 - g / nGrid);
                var gv = (minVal + (g / nGrid) * valRange).toFixed(meteogramTabActive === 'pluie' ? 1 : 0);
                ctx.beginPath();
                ctx.moveTo(padL, gy);
                ctx.lineTo(w - padR, gy);
                ctx.stroke();
                ctx.fillText(gv + ' ' + unit, padL - 8, gy + 4);
            }

            // Tracé des valeurs
            if (meteogramTabActive === 'pluie') {
                var barW = Math.max(3, (chartW / series.length) - 2);
                ctx.fillStyle = 'rgba(56, 189, 248, 0.8)';
                for (var b = 0; b < series.length; b++) {
                    var bx = padL + (b / (series.length - 1 || 1)) * chartW - barW / 2;
                    var bNorm = (series[b].value - minVal) / valRange;
                    var bh = Math.max(2, bNorm * chartH);
                    var by = padT + chartH - bh;
                    ctx.fillRect(bx, by, barW, bh);
                }
            } else {
                var grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
                if (meteogramTabActive === 'temperature') {
                    grad.addColorStop(0, '#ef4444');
                    grad.addColorStop(0.5, '#f59e0b');
                    grad.addColorStop(1, '#00d2ff');
                } else if (meteogramTabActive === 'vent') {
                    grad.addColorStop(0, '#ef4444');
                    grad.addColorStop(1, '#f59e0b');
                } else {
                    grad.addColorStop(0, '#a855f7');
                    grad.addColorStop(1, '#00d2ff');
                }

                ctx.beginPath();
                for (var p = 0; p < series.length; p++) {
                    var px = padL + (p / (series.length - 1 || 1)) * chartW;
                    var py = padT + chartH * (1 - (series[p].value - minVal) / valRange);
                    if (p === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.strokeStyle = grad;
                ctx.lineWidth = 3;
                ctx.stroke();

                for (var pt = 0; pt < series.length; pt++) {
                    var ptx = padL + (pt / (series.length - 1 || 1)) * chartW;
                    var pty = padT + chartH * (1 - (series[pt].value - minVal) / valRange);
                    ctx.beginPath();
                    ctx.arc(ptx, pty, pt === currentStep ? 5 : 2.5, 0, Math.PI * 2);
                    ctx.fillStyle = pt === currentStep ? '#ffffff' : color;
                    ctx.fill();
                    if (pt === currentStep) {
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 2.5;
                        ctx.stroke();
                    }
                }
            }

            // Dates & Heures
            ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.textAlign = 'center';
            var stepSkip = Math.max(1, Math.floor(series.length / 8));
            for (var d = 0; d < series.length; d += stepSkip) {
                var dx = padL + (d / (series.length - 1 || 1)) * chartW;
                var dtObj = series[d].date;
                var timeStr = (dtObj.getUTCHours() < 10 ? '0' : '') + dtObj.getUTCHours() + 'h';
                var dayStr = dtObj.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
                ctx.fillText('H+' + series[d].lead, dx, h - 22);
                ctx.fillText(dayStr + ' ' + timeStr, dx, h - 8);
            }

            meteogramCanvas.onclick = function (ev) {
                var rect = meteogramCanvas.getBoundingClientRect();
                var clickX = ev.clientX - rect.left;
                var ratio = (clickX - padL) / chartW;
                if (ratio >= 0 && ratio <= 1) {
                    var targetIdx = Math.round(ratio * (series.length - 1));
                    if (targetIdx >= 0 && targetIdx < steps.length) {
                        renderStep(targetIdx);
                        drawMeteogram();
                    }
                }
            };
        }



        // ⌨️ RACCOURCIS CLAVIER PRO
        window.addEventListener('keydown', function (e) {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                var stLeft = availableSteps();
                if (stLeft.length) {
                    var prevIdx = (currentStep - 1 + stLeft.length) % stLeft.length;
                    renderStep(prevIdx);
                }
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                var stRight = availableSteps();
                if (stRight.length) {
                    var nextIdx = (currentStep + 1) % stRight.length;
                    renderStep(nextIdx);
                }
            } else if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                if (playButton) playButton.click();
            } else if (e.key === 'Home') {
                e.preventDefault();
                renderStep(0);
            } else if (e.key === 'End') {
                e.preventDefault();
                var stEnd = availableSteps();
                if (stEnd.length) renderStep(stEnd.length - 1);
            } else if (e.key === 'f' || e.key === 'F') {
                if (fullscreen) fullscreen.click();
            } else if (e.key === 'z' || e.key === 'Z' || e.key === 't' || e.key === 'T') {
                toggleTvMode();
            } else if (e.key === 'c' || e.key === 'C') {
                if (captureButton) captureButton.click();
            } else if (e.key === 'j' || e.key === 'J') {
                if (captureJpegButton) captureJpegButton.click();
            } else if (e.key === 'Escape') {
                toggleTvMode(false);
                closeMeteogram();
                if (typeof closeGifModal === 'function') closeGifModal();
            }
        });

        if (pinButton) {
            pinButton.addEventListener('click', function () {
                pinnedEnabled = !pinnedEnabled;
                pinButton.setAttribute('aria-pressed', pinnedEnabled ? 'true' : 'false');
                if (!pinnedEnabled) {
                    clearPinned();
                }
            });
        }
        if (diagramClose) {
            diagramClose.addEventListener('click', closeDiagram);
        }
        viewport.addEventListener('wheel', function (event) {
            event.preventDefault();
            changeZoom(
                transform.scale * Math.pow(1.0015, -event.deltaY),
                event.clientX,
                event.clientY
            );
        }, { passive: false });
        viewport.addEventListener('dblclick', function (event) {
            changeZoom(transform.scale * 1.65, event.clientX, event.clientY);
        });

        function pointerPair() {
            return Array.from(activePointers.values()).slice(0, 2);
        }

        function startGesture() {
            var points = pointerPair();
            if (!points.length) {
                gesture = null;
                return;
            }
            if (points.length === 1) {
                gesture = {
                    type: 'drag',
                    x: points[0].x,
                    y: points[0].y,
                    startX: transform.x,
                    startY: transform.y
                };
                return;
            }
            var centerX = (points[0].x + points[1].x) / 2;
            var centerY = (points[0].y + points[1].y) / 2;
            var distance = Math.hypot(
                points[1].x - points[0].x,
                points[1].y - points[0].y
            );
            var box = viewport.getBoundingClientRect();
            var px = centerX - box.left - box.width / 2;
            var py = centerY - box.top - box.height / 2;
            gesture = {
                type: 'pinch',
                distance: Math.max(distance, 1),
                scale: transform.scale,
                worldX: (px - transform.x) / transform.scale,
                worldY: (py - transform.y) / transform.scale
            };
        }

        viewport.addEventListener('pointermove', function (event) {
            if (event.pointerType && event.pointerType !== 'mouse') {
                return;
            }
            if (activePointers.size) {
                hideProbe();
                return;
            }
            var clientX = event.clientX;
            var clientY = event.clientY;
            lastHover = { x: clientX, y: clientY };
            if (hoverFrame !== null) {
                return;
            }
            hoverFrame = window.requestAnimationFrame(function () {
                hoverFrame = null;
                if (lastHover) {
                    updateProbe(lastHover.x, lastHover.y);
                }
            });
        });
        viewport.addEventListener('pointerleave', hideProbe);

        viewport.addEventListener('pointerdown', function (event) {
            if (event.target.closest('button, .amfm-diagram-popup, .amfm-probe-pinned')) {
                return;
            }
            hideProbe();
            tapStart = {
                x: event.clientX,
                y: event.clientY,
                time: Date.now(),
                pointerId: event.pointerId
            };
            activePointers.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY
            });
            try { viewport.setPointerCapture(event.pointerId); } catch (e) {}
            startGesture();
            viewport.classList.add('is-dragging');
        });
        viewport.addEventListener('pointermove', function (event) {
            if (!activePointers.has(event.pointerId)) {
                return;
            }
            activePointers.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY
            });
            var points = pointerPair();
            if (points.length >= 2) {
                if (!gesture || gesture.type !== 'pinch') {
                    startGesture();
                    return;
                }
                var centerX = (points[0].x + points[1].x) / 2;
                var centerY = (points[0].y + points[1].y) / 2;
                var distance = Math.hypot(
                    points[1].x - points[0].x,
                    points[1].y - points[0].y
                );
                var box = viewport.getBoundingClientRect();
                var px = centerX - box.left - box.width / 2;
                var py = centerY - box.top - box.height / 2;
                transform.scale = clamp(
                    gesture.scale * distance / gesture.distance,
                    1,
                    maxScale
                );
                transform.x = px - gesture.worldX * transform.scale;
                transform.y = py - gesture.worldY * transform.scale;
            } else if (gesture && gesture.type === 'drag') {
                transform.x = gesture.startX + points[0].x - gesture.x;
                transform.y = gesture.startY + points[0].y - gesture.y;
            }
            applyTransform();
        });
        function endPointer(event) {
            var wasMultiTouch = activePointers.size > 1;
            if (activePointers.has(event.pointerId)) {
                activePointers.delete(event.pointerId);
                if (activePointers.size) {
                    startGesture();
                } else {
                    gesture = null;
                }
            }
            if (!activePointers.size) {
                viewport.classList.remove('is-dragging');
            }
            if (tapStart && tapStart.pointerId === event.pointerId) {
                var dx = event.clientX - tapStart.x;
                var dy = event.clientY - tapStart.y;
                var dt = Date.now() - tapStart.time;
                tapStart = null;
                if (!wasMultiTouch && Math.hypot(dx, dy) < 8 && dt < 600) {
                    if (diagramActive || toolMode === 'diagram') {
                        openMeteogramAt(event.clientX, event.clientY);
                    }
                }
            }
        }
        viewport.addEventListener('pointerup', endPointer);
        viewport.addEventListener('pointercancel', endPointer);
        window.addEventListener('resize', applyTransform);

        if (!animationEnabled || reducedMotion) {
            playButton.hidden = true;
        }
        if (!baseUrl) {
            showError('Adresse des données AROME non configurée.');
            return;
        }
        webgl = initialiseWebgl();

        fetchJson(baseUrl + '/maps/index.json')
            .then(function (payload) {
                if (!payload || !payload.layers || !Array.isArray(payload.steps)) {
                    throw new Error('manifeste cartographique invalide');
                }
                manifest = payload;
                applyPaletteStops();
                if (typeof buildLayerMenu === 'function') buildLayerMenu();
                if (typeof buildLegend === 'function') buildLegend();
                if (payload.overlay && typeof loadVectorOverlay === 'function') loadVectorOverlay(payload.overlay);
                if (typeof loadPlaces === 'function') loadPlaces();

                if (run && payload.run_time) {
                    try {
                        run.textContent = 'Run du ' +
                            runFormat.format(new Date(payload.run_time)).replace(':', 'h') +
                            ' • ' + (payload.resolution || '');
                    } catch (e) {}
                }
                if (mapRun && payload.run_time) {
                    try {
                        mapRun.textContent = 'Run ' + (payload.model_name || currentModel) +
                            ' ' + runLabelUtc(payload.run_time);
                    } catch (e) {}
                }
                if (generated && payload.generated_at) {
                    try {
                        generated.textContent = 'Cartes mises à jour le ' +
                            runFormat.format(new Date(payload.generated_at)).replace(':', 'h') +
                            ' • Module v' + moduleVersion;
                    } catch (e) {}
                }
                if (stale && payload.generated_at) {
                    stale.hidden = (Date.now() - new Date(payload.generated_at).getTime()) <=
                        8 * 60 * 60 * 1000;
                }
                var steps = availableSteps();
                currentStep = initialStep(steps);
                if (typeof setLayerMenuOpen === 'function') {
                    setLayerMenuOpen(!window.matchMedia ||
                        !window.matchMedia('(max-width: 760px)').matches);
                }
                var dSel = document.getElementById('direct-layer-select');
                if (dSel) {
                    var isFranceOnlyInit = (currentModel.indexOf('_france') !== -1);
                    var isArpegeEuInit = (currentModel === 'arpege');
                    var tempGroup = dSel.querySelector('optgroup[label*="Températures"]');
                    if (tempGroup) {
                        tempGroup.hidden = isArpegeEuInit;
                        tempGroup.style.display = isArpegeEuInit ? 'none' : '';
                    }
                    var tnOpt = dSel.querySelector('option[value="temperature_min_24h"]');
                    if (tnOpt) { tnOpt.hidden = !isFranceOnlyInit; tnOpt.style.display = isFranceOnlyInit ? '' : 'none'; }
                    var txOpt = dSel.querySelector('option[value="temperature_max_24h"]');
                    if (txOpt) { txOpt.hidden = !isFranceOnlyInit; txOpt.style.display = isFranceOnlyInit ? '' : 'none'; }
                }
                var regSel = document.getElementById('select-region');
                if (regSel) {
                    var isFr = (currentModel.indexOf('_france') !== -1);
                    var grpFr = regSel.querySelector('#optgroup-fr');
                    var grpEu = regSel.querySelector('#optgroup-eu');
                    var grpWorld = regSel.querySelector('#optgroup-world');
                    if (grpFr) { grpFr.hidden = !isFr; grpFr.style.display = isFr ? '' : 'none'; }
                    if (grpEu) { grpEu.hidden = isFr; grpEu.style.display = isFr ? 'none' : ''; }
                    if (grpWorld) { grpWorld.hidden = isFr; grpWorld.style.display = isFr ? 'none' : ''; }
                    var allOpts = regSel.querySelectorAll('option');
                    for (var oi = 0; oi < allOpts.length; oi++) {
                        allOpts[oi].hidden = isFr ? (allOpts[oi].classList.contains('opt-eu') || allOpts[oi].classList.contains('opt-world')) : allOpts[oi].classList.contains('opt-fr');
                    }
                }
                applyUrlParams();
                renderStep(currentStep);
                isInitializing = false;
                updateUrl();
            })
            .catch(function (error) {
                console.error('Erreur chargement manifeste:', error);
                if (typeof showError === 'function') {
                    showError('Chargement des cartes : ' + error.message);
                }
            });

        // ────────────────────────────────────────────────────────────────────
        // 🌀 TRACKER TEMPS RÉEL DES CYCLONES & TYPHONS MONDIAUX (NHC & JTWC)
        // ────────────────────────────────────────────────────────────────────

        function initCycloneTracker() {
            var bar = document.getElementById('cyclone-alert-bar');
            var container = document.getElementById('cyclone-items');
            if (!bar || !container) return;

            function processCycloneData(data) {
                if (!data || !data.storms || data.storms.length === 0) {
                    bar.style.display = 'none';
                    return;
                }
                activeCyclonesData = data.storms;
                window.activeCyclonesData = activeCyclonesData;
                container.innerHTML = '';

                // 1. Bouton "Tous les phénomènes (N)" dans le bandeau
                var allBtn = document.getElementById('btn-open-cyclones-modal');
                if (allBtn) {
                    allBtn.onclick = function(e) {
                        e.preventDefault();
                        openCyclonesModal();
                    };
                }
                var titleEl = bar.querySelector('.cyclone-title');
                if (titleEl) {
                    titleEl.style.cursor = 'pointer';
                    titleEl.onclick = function(e) {
                        e.preventDefault();
                        openCyclonesModal();
                    };
                }
                var navBtn = document.getElementById('amfm-btn-cyclones-modal');
                if (navBtn) {
                    navBtn.onclick = function(e) {
                        e.preventDefault();
                        openCyclonesModal();
                    };
                }
                var countBadge = document.getElementById('cyclone-total-count');
                if (countBadge) countBadge.textContent = String(data.storms.length);

                // 2. Pastilles horizontales dans le bandeau ticker
                for (var i = 0; i < data.storms.length; i++) {
                    var s = data.storms[i];
                    var pill = document.createElement('button');
                    pill.type = 'button';
                    var isInvest = (s.type === 'invest');
                    var cName = getCleanStormName(s, false);
                    pill.className = isInvest ? 'cyclone-pill cyclone-pill-invest' : 'cyclone-pill';
                    if (isInvest) {
                        pill.innerHTML = '🟡 <strong>' + cName + '</strong> (' + (s.probability || 'En surveillance') + ')';
                        pill.title = 'Surveillance INVEST : ' + cName + ' — ' + (s.probability || '') + ' (Bassin ' + s.basin + ')';
                    } else {
                        pill.innerHTML = '🔴 <strong>' + cName + '</strong> (' + s.category + ' • ' + s.wind_kmh + ' km/h)';
                        pill.title = 'Cyclone Actif : ' + cName + ' — ' + s.category + ' (Bassin ' + s.basin + ')';
                    }
                    (function(storm) {
                        pill.addEventListener('click', function(e) {
                            e.preventDefault();
                            focusOnCyclone(storm);
                        });
                    })(s);
                    container.appendChild(pill);
                }
                var closeBtn = document.getElementById('cyclone-close-btn');
                if (closeBtn) {
                    closeBtn.onclick = function() {
                        bar.style.display = 'none';
                    };
                }
                bar.style.display = 'flex';
                scheduleRender();
                checkCycloneAnimation();

                // 3. Paramètre direct dans l'URL (?cyclone=lowell ou ?cyclone=ep122026)
                if (urlInitParams && typeof urlInitParams.get === 'function') {
                    var initC = urlInitParams.get('cyclone');
                    if (initC && activeCyclonesData && activeCyclonesData.length > 0) {
                        var q = initC.toLowerCase();
                        var match = activeCyclonesData.find(function(st) {
                            return (st.id && st.id.toLowerCase() === q) || (st.name && st.name.toLowerCase().indexOf(q) !== -1);
                        });
                        if (match) {
                            window.setTimeout(function() { focusOnCyclone(match); }, 250);
                        }
                    }
                }
            }

            fetch('cyclones_actifs.json?t=' + Date.now())
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data) {
                        processCycloneData(data);
                    } else {
                        fetch('output/cyclones_actifs.json?t=' + Date.now())
                            .then(function(r2) { return r2.ok ? r2.json() : null; })
                            .then(function(data2) { processCycloneData(data2); })
                            .catch(function(err) { console.warn('Cyclone Tracker Fallback :', err); });
                    }
                })
                .catch(function(err) {
                    fetch('output/cyclones_actifs.json?t=' + Date.now())
                        .then(function(r2) { return r2.ok ? r2.json() : null; })
                        .then(function(data2) { processCycloneData(data2); })
                        .catch(function(err2) { console.warn('Cyclone Tracker :', err, err2); });
                });
        }

        function getBasinLabel(basin) {
            var labels = {
                pacifique_est: '🌊 Pacifique Nord-Est & Hawaï',
                pacifique_ouest: '🌀 Pacifique Ouest & Asie (Typhons)',
                pacifique_sud: '🏝️ Pacifique Sud & Océanie',
                ocean_indien: '🇷🇪 Océan Indien Sud-Ouest (Réunion • Maurice)',
                ocean_indien_nord: '🇮🇳 Océan Indien Nord (Bengale • Mer d\'Arabie)',
                antilles: '🏝️ Arc Antillais & Atlantique Tropical',
                etats_unis: '🇺🇸 États-Unis & Golfe du Mexique'
            };
            return labels[basin] || basin;
        }

        function openCyclonesModal() {
            var modal = document.getElementById('amfm-modal-cyclones');
            if (!modal) return;

            var statsContainer = document.getElementById('cyclones-modal-stats');
            var listContainer = document.getElementById('cyclones-modal-list');

            if (!activeCyclonesData || activeCyclonesData.length === 0) {
                if (listContainer) {
                    listContainer.innerHTML = '<div class="amfm-modal-empty">Aucun phénomène cyclonique actif identifié pour le moment.</div>';
                }
                modal.style.display = 'flex';
                return;
            }

            var cyclonesCount = activeCyclonesData.filter(function(s) { return s.type === 'cyclone'; }).length;
            var investsCount = activeCyclonesData.filter(function(s) { return s.type === 'invest'; }).length;

            if (statsContainer) {
                statsContainer.innerHTML =
                    '<div class="amfm-stat-pill"><strong>' + activeCyclonesData.length + '</strong> Phénomènes totaux</div>' +
                    '<div class="amfm-stat-pill stat-cyclone">🔴 <strong>' + cyclonesCount + '</strong> Cyclone(s) &amp; Ouragan(s)</div>' +
                    '<div class="amfm-stat-pill stat-invest">🟡 <strong>' + investsCount + '</strong> INVEST(s) sous surveillance</div>';
            }

            if (listContainer) {
                listContainer.innerHTML = '';
                for (var i = 0; i < activeCyclonesData.length; i++) {
                    var s = activeCyclonesData[i];
                    var isInvest = (s.type === 'invest');
                    var card = document.createElement('div');
                    card.className = 'amfm-cyclone-card ' + (isInvest ? 'is-invest' : 'is-cyclone');

                    var lat = Number(s.lat !== undefined ? s.lat : s.latitude);
                    var lon = Number(s.lon !== undefined ? s.lon : s.longitude);
                    var coordsStr = Number.isFinite(lat) && Number.isFinite(lon) ?
                        (Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S') + ' · ' + Math.abs(lon).toFixed(1) + '°' + (lon >= 0 ? 'E' : 'O')) : 'En mer';

                    var html =
                        '<div class="amfm-cyclone-card-header">' +
                            '<div class="amfm-cyclone-name-group">' +
                                '<span class="amfm-cyclone-status-badge">' + (isInvest ? '🟡 INVEST' : '🔴 CYCLONE') + '</span>' +
                                '<h3 class="amfm-cyclone-name">' + getCleanStormName(s, false) + '</h3>' +
                            '</div>' +
                            '<span class="amfm-cyclone-cat-badge">' + s.category + '</span>' +
                        '</div>' +
                        '<div class="amfm-cyclone-grid">' +
                            '<div class="amfm-cyclone-data-item"><span class="amfm-data-label">Vents soutenus</span><span class="amfm-data-val">💨 ' + (s.wind_kmh || 0) + ' km/h</span></div>' +
                            '<div class="amfm-cyclone-data-item"><span class="amfm-data-label">Pression min.</span><span class="amfm-data-val">⏱️ ' + (s.pressure_hpa || 1010) + ' hPa</span></div>' +
                            '<div class="amfm-cyclone-data-item"><span class="amfm-data-label">Coordonnées</span><span class="amfm-data-val">📍 ' + coordsStr + '</span></div>' +
                            '<div class="amfm-cyclone-data-item"><span class="amfm-data-label">Déplacement</span><span class="amfm-data-val">🧭 ' + (s.movement || 'Suivi actif') + '</span></div>' +
                            '<div class="amfm-cyclone-data-item amfm-grid-col2"><span class="amfm-data-label">Bassin géographique</span><span class="amfm-data-val">' + getBasinLabel(s.basin) + '</span></div>' +
                            '<div class="amfm-cyclone-data-item amfm-grid-col2"><span class="amfm-data-label">Source officielle</span><span class="amfm-data-val">📡 ' + (s.source || 'NOAA / NHC') + '</span></div>' +
                        '</div>' +
                        '<div class="amfm-cyclone-card-footer">' +
                            '<button type="button" class="amfm-btn-cyclone-focus" data-storm-idx="' + i + '">' +
                                '<i class="fa-solid fa-crosshairs"></i> Centrer et zoomer sur la carte' +
                            '</button>' +
                        '</div>';

                    card.innerHTML = html;
                    (function(storm) {
                        card.style.cursor = 'pointer';
                        card.addEventListener('click', function(e) {
                            e.preventDefault();
                            closeCyclonesModal();
                            focusOnCyclone(storm);
                        });
                    })(s);

                    listContainer.appendChild(card);
                }
            }

            modal.style.display = 'flex';
        }

        function closeCyclonesModal() {
            var modal = document.getElementById('amfm-modal-cyclones');
            if (modal) modal.style.display = 'none';
        }

        window.openCyclonesModal = openCyclonesModal;
        window.closeCyclonesModal = closeCyclonesModal;

        function getStormTargetRegion(storm) {
            var lat = Number(storm.lat !== undefined ? storm.lat : storm.latitude);
            var lon = Number(storm.lon !== undefined ? storm.lon : storm.longitude);
            var basin = String(storm.basin || '').toLowerCase();

            // 1. Détection prioritaire par coordonnées géographiques exactes
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                // Bassin Pacifique Est & Hawaï (-180° à -100°O, 0°N à 45°N)
                if (lon >= -180 && lon <= -100 && lat >= 0 && lat <= 45) {
                    return 'pacifique_est';
                }
                // Bassin États-Unis & Golfe du Mexique (-128° à -66°O, 23°N à 52°N)
                if (lat >= 23 && ((lon >= -128 && lon < -75) || (lon >= -75 && lon <= -66 && lat > 32))) {
                    return 'etats_unis';
                }
                // Bassin Arc Antillais & Atlantique Tropical (-75° à -20°O, 5°N à 33°N)
                if (lon >= -75 && lon <= -20 && lat >= 5 && lat <= 33) {
                    return 'antilles';
                }
                // Caraïbes occidentales (< -75°O et lat < 23°N)
                if (lon >= -95 && lon < -75 && lat >= 8 && lat < 23) {
                    return 'antilles';
                }
                // Océan Indien Sud-Ouest (Madagascar • Réunion • Maurice : lat < 0, 35° à 85°E)
                if (lat < 0 && lon >= 35 && lon <= 85) {
                    return 'ocean_indien';
                }
                // Océan Indien Nord (Golfe du Bengale • Mer d'Arabie • Inde : lat >= 0, 50° à 100°E)
                if (lat >= 0 && lon >= 50 && lon <= 100) {
                    return 'ocean_indien_nord';
                }
                // Pacifique Sud & Océanie (lat < 0, lon >= 125 ou lon <= -170)
                if (lat < 0 && (lon >= 125 || lon <= -170)) {
                    return 'pacifique_sud';
                }
                // Pacifique Ouest & Asie (Typhons Chine • Japon • Philippines : lat >= 0, 100° à 180°E)
                if (lat >= 0 && lon >= 100 && lon <= 180) {
                    return 'pacifique_ouest';
                }
            }

            // 2. Fallback par code ou nom de bassin
            if (basin === 'etats_unis' || basin === 'usa' || basin === 'conus') return 'etats_unis';
            if (basin === 'ep' || basin === 'cp' || basin === 'pacifique_est') return 'pacifique_est';
            if (basin === 'wp' || basin === 'pacifique_ouest') return 'pacifique_ouest';
            if (basin === 'sp' || basin === 'sh' || basin === 'pacifique_sud') return 'pacifique_sud';
            if (basin === 'io' || basin === 'swio' || basin === 'ocean_indien') return 'ocean_indien';
            if (basin === 'nio' || basin === 'ocean_indien_nord') return 'ocean_indien_nord';
            if (basin === 'al' || basin === 'caraibes' || basin === 'antilles') return 'antilles';

            return 'antilles';
        }

        function focusOnCyclone(storm) {
            if (!storm) return;
            closeCyclonesModal();

            var lat = Number(storm.lat !== undefined ? storm.lat : storm.latitude);
            var lon = Number(storm.lon !== undefined ? storm.lon : storm.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

            var targetRegion = getStormTargetRegion(storm);

            // Basculer sur vent si le paramètre actuel est spécifique à la France
            if (currentLayer === 'temperature_max_24h' || currentLayer === 'temperature_min_24h') {
                currentLayer = 'vent';
                var dSel = document.getElementById('direct-layer-select');
                if (dSel) dSel.value = 'vent';
            }

            var isAifs = (currentModel && currentModel.indexOf('aifs') !== -1 && currentModel !== 'aifs_france');
            var targetModel = (isAifs ? 'aifs_' : 'gfs_') + targetRegion;

            var focus = {
                latitude: lat,
                longitude: lon,
                scale: 3.2,
                isCyclone: true
            };

            // 1. Synchroniser le menu région sur le bassin du cyclone
            var selectRegion = document.getElementById('select-region');
            if (selectRegion && targetRegion && selectRegion.querySelector('option[value="' + targetRegion + '"]')) {
                selectRegion.value = targetRegion;
            }

            // 2. Synchroniser le sélecteur de modèle
            var selectModel = document.getElementById('select-model');
            if (selectModel && selectModel.querySelector('option[value="' + targetModel + '"]')) {
                selectModel.value = targetModel;
            }

            // 3. Bascule de modèle ou centrage direct
            var currentMatchesDomain = (currentModel === ('gfs_' + targetRegion)) || (currentModel === ('aifs_' + targetRegion));
            if (!currentMatchesDomain) {
                pendingFocus = focus;
                switchModel(targetModel);
            } else {
                focusLocation(focus);
            }

            // 4. Notification d'alerte immédiate
            if (typeof setToolHint === 'function') {
                var cName = getCleanStormName(storm, false);
                if (storm.type === 'invest') {
                    setToolHint('🟡 Zoom direct sur ' + cName + ' (' + (storm.probability || 'En surveillance') + ')');
                } else {
                    setToolHint('🔴 Zoom direct sur ' + cName + ' (' + storm.category + ' • ' + storm.wind_kmh + ' km/h, ' + storm.pressure_hpa + ' hPa)');
                }
            }
        }

        initCycloneTracker();
        var modalClose = document.getElementById('cyclones-modal-close');
        if (modalClose) modalClose.onclick = closeCyclonesModal;
        var modal = document.getElementById('amfm-modal-cyclones');
        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === modal) closeCyclonesModal();
            });
        }
        window.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeCyclonesModal();
                closeWorldAlertsModal();
            }
        });

        // ── 🌍 MODULE DE SURVEILLANCE MONDIALE DES PHÉNOMÈNES EXTRÊMES (J+1 À J+16) ──
        // ── 🌍 MODULE VOLET / ONGLET MONDIAL DES EXTRÊMES (J+1 À J+16) ───────────
        // Filtré strictement sur : Cyclone, Tempête, Inondation, Orage
        var worldAlertsData = null;
        var worldAlertsFilterRisk = 'all';
        var worldAlertsFilterHorizon = 'all';
        var worldAlertsSearchQuery = '';
        var ALLOWED_WORLD_RISKS = ['cyclone', 'tempete', 'inondation', 'orage'];

        function initWorldAlerts() {
            function processWorldAlertsData(data) {
                if (!data || !Array.isArray(data.alerts)) return;
                
                // Filtrer strictement sur les 4 catégories demandées
                var validAlerts = data.alerts.filter(function(a) {
                    return ALLOWED_WORLD_RISKS.indexOf(a.type) !== -1;
                });
                
                worldAlertsData = {
                    total_alerts: validAlerts.length,
                    alerts: validAlerts
                };

                // 1. Mettre à jour les badges de compteur (Navbar + Bandeau)
                var total = validAlerts.length;
                var countBadge = document.getElementById('world-alerts-count');
                if (countBadge) {
                    countBadge.textContent = total;
                    countBadge.style.display = total > 0 ? 'inline-block' : 'none';
                }
                var barTotalCount = document.getElementById('world-alerts-total-count');
                if (barTotalCount) {
                    barTotalCount.textContent = total;
                }
            }

            fetch('alertes_extremes_monde.json?t=' + Date.now())
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data) {
                        processWorldAlertsData(data);
                    } else {
                        fetch('output/alertes_extremes_monde.json?t=' + Date.now())
                            .then(function(r2) { return r2.ok ? r2.json() : null; })
                            .then(function(data2) { processWorldAlertsData(data2); })
                            .catch(function(err) { console.warn('World Alerts Fallback :', err); });
                    }
                })
                .catch(function(err) {
                    fetch('output/alertes_extremes_monde.json?t=' + Date.now())
                        .then(function(r2) { return r2.ok ? r2.json() : null; })
                        .then(function(data2) { processWorldAlertsData(data2); })
                        .catch(function(err2) { console.warn('World Alerts :', err, err2); });
                });
        }

        // ── 🎯 ATTERRISSAGE SUR LA CARTE DEPUIS L'OBSERVATOIRE DES EXTRÊMES ───
        function checkUrlDeepLink() {
            var params = urlInitParams || new URLSearchParams(window.location.search);
            if (!params) return;
            var latStr = params.get('lat');
            var lonStr = params.get('lon');
            if (!latStr || !lonStr) return;

            var lat = parseFloat(latStr);
            var lon = parseFloat(lonStr);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

            var targetModel = params.get('model') || 'gfs';
            var targetDomain = params.get('domain') || 'europe';
            var targetLayer = params.get('layer') || params.get('parametre');
            var leadHour = parseInt(params.get('lead') || params.get('lead_hour'), 10);
            var title = params.get('title') || 'Phénomène Extrême';
            var country = params.get('country') || '';
            var icon = params.get('icon') || '⚠️';

            // 1. Calque météorologique adéquat
            if (targetLayer && targetLayer !== currentLayer) {
                currentLayer = targetLayer;
                var dSel = document.getElementById('direct-layer-select');
                if (dSel && dSel.querySelector('option[value="' + targetLayer + '"]')) {
                    dSel.value = targetLayer;
                }
            }

            // 2. Coordonnées de ciblage
            var focus = {
                latitude: lat,
                longitude: lon,
                scale: 3.4,
                isCyclone: true,
                searchLabel: icon + ' ' + title + (country ? ' (' + country + ')' : '')
            };

            // 3. Bascule de modèle et positionnement sur le pas horaire
            if (currentModel !== targetModel) {
                pendingFocus = focus;
                if (Number.isFinite(leadHour)) {
                    pendingStepLead = leadHour;
                }
                var selModel = document.getElementById('select-model');
                if (selModel && selModel.querySelector('option[value="' + targetModel + '"]')) {
                    selModel.value = targetModel;
                }
                switchModel(targetModel);
            } else {
                if (Number.isFinite(leadHour)) {
                    var steps = availableSteps();
                    if (steps && steps.length > 0) {
                        var bestIdx = 0;
                        var bestDiff = 999999;
                        for (var si = 0; si < steps.length; si++) {
                            var diff = Math.abs((steps[si].lead_hour || 0) - leadHour);
                            if (diff < bestDiff) {
                                bestDiff = diff;
                                bestIdx = si;
                            }
                        }
                        renderStep(bestIdx);
                    }
                }
                focusLocation(focus);
                if (typeof dropSearchPin === 'function') {
                    dropSearchPin(lat, lon, icon + ' ' + title);
                }
            }

            // 4. Notification explicite à l'utilisateur
            if (typeof setToolHint === 'function') {
                setToolHint('🎯 ' + icon + ' ' + title + (country ? ' · ' + country : '') + (Number.isFinite(leadHour) ? ' (Échéance H+' + leadHour + ')' : ''));
            }
        }

        initWorldAlerts();
        setTimeout(checkUrlDeepLink, 150);

        // ── 🔍 MODULE DE RECHERCHE MONDIALE (Adresse, Ville, Pays) ───────────────
        function dropSearchPin(lat, lon, label) {
            var proj = projectCoords(lat, lon);
            if (!proj || proj.u < 0 || proj.u > 1 || proj.v < 0 || proj.v > 1) {
                return;
            }
            clearPinned();
            var layer = manifest && manifest.layers && manifest.layers[currentLayer] ? manifest.layers[currentLayer] : null;
            var value = null;
            var estimated = false;
            if (layer && typeof samplePalette === 'function') {
                value = samplePalette(proj.u, proj.v, layer);
                estimated = value !== null;
            }
            pinnedElement = document.createElement('div');
            pinnedElement.className = 'amfm-probe amfm-probe-pinned amfm-probe-search';

            var title = document.createElement('div');
            title.className = 'amfm-probe-search-title';
            title.innerHTML = '<i class="fa-solid fa-location-dot" style="color:#f59e0b;"></i> <span>' + (label || 'Position recherchée') + '</span>';
            pinnedElement.appendChild(title);

            if (value !== null && Number.isFinite(value)) {
                var decimals = clamp(Number(layer.decimals) || 0, 0, 2);
                var formatted = Number(value).toLocaleString('fr-FR', {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals
                });
                var strong = document.createElement('strong');
                strong.textContent = (estimated ? '≈ ' : '') + formatted + (layer.unit ? ' ' + layer.unit : '');
                var lbl = document.createElement('span');
                lbl.className = 'amfm-probe-label';
                lbl.textContent = layer.label || currentLayer;
                pinnedElement.appendChild(strong);
                pinnedElement.appendChild(lbl);
            }

            var close = document.createElement('button');
            close.type = 'button';
            close.className = 'amfm-probe-pin-close';
            close.setAttribute('aria-label', 'Retirer l’épingle');
            close.textContent = '×';
            close.addEventListener('click', function (event) {
                event.stopPropagation();
                clearPinned();
            });
            pinnedElement.appendChild(close);
            viewport.appendChild(pinnedElement);
            pinnedPoint = { u: proj.u, v: proj.v };
            positionPinned();
        }

        function isCoordsInCurrentDomain(lat, lon) {
            if (!manifest || !manifest.bounds) return false;
            var b = manifest.bounds;
            var w = Number(b.west);
            var e = Number(b.east);
            var s = Number(b.south);
            var n = Number(b.north);
            if (!Number.isFinite(w) || !Number.isFinite(e) || !Number.isFinite(s) || !Number.isFinite(n)) return false;
            var minLon = Math.min(w, e);
            var maxLon = Math.max(w, e);
            var minLat = Math.min(s, n);
            var maxLat = Math.max(s, n);
            return (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon);
        }

        function findBestDomainForCoords(lat, lon) {
            // 1. France métropolitaine
            if (lat >= 41.2 && lat <= 51.3 && lon >= -5.2 && lon <= 9.6) {
                return { domain: 'france', model: (currentModel && currentModel.indexOf('aifs') !== -1) ? 'aifs_france' : 'arpege_france' };
            }
            // 2. Arc Antillais & Caraïbes
            if (lat >= 7.0 && lat <= 32.0 && lon >= -75.0 && lon <= -30.0) {
                return { domain: 'antilles', model: (currentModel && currentModel.indexOf('aifs') !== -1) ? 'aifs_antilles' : 'gfs_antilles' };
            }
            // 3. États-Unis (CONUS)
            if (lat >= 23.0 && lat <= 51.85 && lon >= -128.0 && lon <= -66.0) {
                return { domain: 'etats_unis', model: (currentModel && currentModel.indexOf('aifs') !== -1) ? 'aifs_etats_unis' : 'gfs_etats_unis' };
            }
            // 4. Océan Indien Sud-Ouest (Réunion, Madagascar, Maurice)
            if (lat >= -28.5 && lat <= -8.5 && lon >= 38.0 && lon <= 74.0) {
                return { domain: 'ocean_indien', model: (currentModel && currentModel.indexOf('aifs') !== -1) ? 'aifs_ocean_indien' : 'gfs_ocean_indien' };
            }
            // 5. Océan Indien Nord (Inde, Sri Lanka, Mer d'Arabie, Golfe du Bengale)
            if (lat >= 2.0 && lat <= 36.0 && lon >= 60.0 && lon <= 98.0) {
                return { domain: 'ocean_indien_nord', model: (currentModel && currentModel.indexOf('aifs') !== -1) ? 'aifs_ocean_indien_nord' : 'gfs_ocean_indien_nord' };
            }
            // 6. Asie de l'Est & Pacifique Ouest (Chine, Japon, Corée, Philippines, Taïwan)
            if (lat >= 0.0 && lat <= 48.0 && lon >= 100.0 && lon <= 155.0) {
                return { domain: 'pacifique_ouest', model: (currentModel && currentModel.indexOf('aifs') !== -1) ? 'aifs_pacifique_ouest' : 'gfs_pacifique_ouest' };
            }
            // 7. Pacifique Sud & Océanie (Australie, Nouvelle-Calédonie, Fidji)
            if (lat >= -36.0 && lat <= -8.5 && lon >= 130.0 && lon <= 180.0) {
                return { domain: 'pacifique_sud', model: (currentModel && currentModel.indexOf('aifs') !== -1) ? 'aifs_pacifique_sud' : 'gfs_pacifique_sud' };
            }
            // 8. Pacifique Est & Hawaï
            if (lat >= 2.0 && lat <= 40.0 && ((lon >= -170.0 && lon <= -100.0) || (lon >= 190.0 && lon <= 260.0))) {
                return { domain: 'pacifique_est', model: (currentModel && currentModel.indexOf('aifs') !== -1) ? 'aifs_pacifique_est' : 'gfs_pacifique_est' };
            }
            // 9. Europe élargie (Europe, Maghreb, Proche-Orient, Atlantique Nord, Islande)
            if (lat >= 18.0 && lat <= 75.0 && lon >= -60.0 && lon <= 50.0) {
                return { domain: 'europe', model: (currentModel && currentModel.indexOf('arpege') !== -1) ? 'arpege' : ((currentModel && currentModel.indexOf('aifs') !== -1) ? 'aifs' : 'gfs') };
            }
            // Par défaut
            return { domain: 'europe', model: 'gfs' };
        }

        function landOnLocation(lat, lon, label, scale) {
            var zoomScale = scale || 3.5;
            var inCurrent = isCoordsInCurrentDomain(lat, lon);
            var focus = { latitude: lat, longitude: lon, scale: zoomScale, searchLabel: label };

            if (inCurrent) {
                focusLocation(focus);
                dropSearchPin(lat, lon, label);
                if (typeof setToolHint === 'function') {
                    setToolHint('📍 ' + label);
                }
            } else {
                var best = findBestDomainForCoords(lat, lon);
                pendingFocus = focus;
                if (typeof setToolHint === 'function') {
                    setToolHint('✈️ Navigation vers ' + label + ' (Domaine ' + best.domain.toUpperCase() + ')…');
                }
                var selectEl = document.getElementById('select-model');
                if (selectEl) {
                    selectEl.value = best.model;
                }
                switchModel(best.model);
            }
        }

        function initGlobalSearch() {
            var input = document.getElementById('amfm-search-input');
            var clearBtn = document.getElementById('amfm-search-clear');
            var dropdown = document.getElementById('amfm-search-dropdown');
            var wrapper = document.getElementById('amfm-search-wrapper');
            if (!input || !dropdown || !wrapper) return;

            var debounceTimer = null;
            var currentSelectedIndex = -1;
            var currentResults = [];

            // Raccourcis clavier universels : Ctrl+K ou "/" pour focus la recherche
            window.addEventListener('keydown', function (e) {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                    e.preventDefault();
                    input.focus();
                    input.select();
                } else if (e.key === '/' && document.activeElement !== input && (!document.activeElement || (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA'))) {
                    e.preventDefault();
                    input.focus();
                    input.select();
                }
            });

            function renderDropdown(items) {
                currentResults = items || [];
                currentSelectedIndex = -1;
                dropdown.innerHTML = '';
                if (!currentResults.length) {
                    dropdown.innerHTML = '<div class="amfm-search-hint">Aucun résultat trouvé. Précisez la ville ou le pays.</div>';
                    dropdown.style.display = 'flex';
                    return;
                }
                for (var i = 0; i < currentResults.length; i++) {
                    var it = currentResults[i];
                    var div = document.createElement('div');
                    div.className = 'amfm-search-item';
                    div.dataset.index = i;
                    div.innerHTML =
                        '<i class="fa-solid ' + (it.icon || 'fa-location-dot') + ' amfm-search-item-icon" style="color:var(--amfm-accent);"></i>' +
                        '<div class="amfm-search-item-info">' +
                            '<span class="amfm-search-item-title">' + (it.title || '') + '</span>' +
                            '<span class="amfm-search-item-sub">' + (it.subtitle || '') + '</span>' +
                        '</div>' +
                        '<span class="amfm-search-badge-domain">' + (it.domainBadge || '') + '</span>';
                    div.addEventListener('click', (function (item) {
                        return function () {
                            selectItem(item);
                        };
                    })(it));
                    dropdown.appendChild(div);
                }
                dropdown.style.display = 'flex';
            }

            function selectItem(item) {
                if (!item) return;
                input.value = item.title + (item.subtitle ? ', ' + item.subtitle : '');
                if (clearBtn) clearBtn.style.display = 'inline-flex';
                dropdown.style.display = 'none';
                landOnLocation(item.lat, item.lon, item.title, item.scale);
            }

            function executeSearch(query) {
                var q = query.trim();
                if (q.length < 2) {
                    dropdown.style.display = 'none';
                    return;
                }
                var photonUrl = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=6&lang=fr';
                fetch(photonUrl)
                    .then(function (res) {
                        if (!res.ok) throw new Error('Photon status ' + res.status);
                        return res.json();
                    })
                    .then(function (data) {
                        var items = [];
                        if (data && data.features && data.features.length) {
                            data.features.forEach(function (feat) {
                                var p = feat.properties || {};
                                var geom = feat.geometry || {};
                                var coords = geom.coordinates;
                                if (!coords || coords.length < 2) return;
                                var lon = Number(coords[0]);
                                var lat = Number(coords[1]);
                                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

                                var title = p.housenumber ? (p.housenumber + ' ' + (p.street || p.name || '')) : (p.name || p.street || p.city || '');
                                var subParts = [];
                                if (p.postcode) subParts.push(p.postcode);
                                if (p.city && p.city !== title) subParts.push(p.city);
                                else if (p.district) subParts.push(p.district);
                                if (p.state) subParts.push(p.state);
                                if (p.country) subParts.push(p.country);
                                var subtitle = subParts.join(', ');

                                var icon = 'fa-location-dot';
                                if (p.osm_key === 'place' || p.type === 'city' || p.type === 'town') icon = 'fa-city';
                                else if (p.osm_key === 'highway' || p.street) icon = 'fa-road';
                                else if (p.osm_key === 'building' || p.osm_key === 'amenity') icon = 'fa-building';
                                else if (p.osm_value === 'country') icon = 'fa-globe';

                                var domainInfo = findBestDomainForCoords(lat, lon);
                                var domainBadge = domainInfo ? domainInfo.domain.toUpperCase().replace('_', ' ') : 'MONDE';

                                items.push({
                                    title: title || subtitle,
                                    subtitle: subtitle,
                                    lat: lat,
                                    lon: lon,
                                    icon: icon,
                                    domainBadge: domainBadge,
                                    scale: (p.osm_value === 'country') ? 1.8 : ((p.type === 'city' || p.type === 'town') ? 2.8 : 3.6)
                                });
                            });
                        }
                        if (items.length) {
                            renderDropdown(items);
                        } else {
                            fallbackOpenMeteo(q);
                        }
                    })
                    .catch(function () {
                        fallbackOpenMeteo(q);
                    });
            }

            function fallbackOpenMeteo(q) {
                var omUrl = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=6&language=fr&format=json';
                fetch(omUrl)
                    .then(function (res) { return res.json(); })
                    .then(function (data) {
                        var items = [];
                        if (data && data.results && data.results.length) {
                            data.results.forEach(function (r) {
                                var subParts = [];
                                if (r.admin1) subParts.push(r.admin1);
                                if (r.country) subParts.push(r.country);
                                var subtitle = subParts.join(', ');
                                var domainInfo = findBestDomainForCoords(r.latitude, r.longitude);
                                items.push({
                                    title: r.name,
                                    subtitle: subtitle,
                                    lat: r.latitude,
                                    lon: r.longitude,
                                    icon: 'fa-city',
                                    domainBadge: domainInfo ? domainInfo.domain.toUpperCase().replace('_', ' ') : 'MONDE',
                                    scale: 2.8
                                });
                            });
                        }
                        renderDropdown(items);
                    })
                    .catch(function () {
                        renderDropdown([]);
                    });
            }

            input.addEventListener('input', function () {
                var val = input.value;
                if (clearBtn) clearBtn.style.display = val.length ? 'inline-flex' : 'none';
                if (debounceTimer) clearTimeout(debounceTimer);
                if (val.trim().length < 2) {
                    dropdown.style.display = 'none';
                    return;
                }
                debounceTimer = setTimeout(function () {
                    executeSearch(val);
                }, 260);
            });

            input.addEventListener('keydown', function (e) {
                if (!currentResults.length || dropdown.style.display === 'none') {
                    if (e.key === 'Enter' && input.value.trim().length >= 2) {
                        e.preventDefault();
                        executeSearch(input.value);
                    }
                    return;
                }
                var itemEls = dropdown.querySelectorAll('.amfm-search-item');
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    currentSelectedIndex = (currentSelectedIndex + 1) % currentResults.length;
                    itemEls.forEach(function (el, idx) {
                        el.classList.toggle('is-selected', idx === currentSelectedIndex);
                        if (idx === currentSelectedIndex) el.scrollIntoView({ block: 'nearest' });
                    });
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    currentSelectedIndex = (currentSelectedIndex - 1 + currentResults.length) % currentResults.length;
                    itemEls.forEach(function (el, idx) {
                        el.classList.toggle('is-selected', idx === currentSelectedIndex);
                        if (idx === currentSelectedIndex) el.scrollIntoView({ block: 'nearest' });
                    });
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    var selectedIdx = currentSelectedIndex >= 0 ? currentSelectedIndex : 0;
                    if (currentResults[selectedIdx]) {
                        selectItem(currentResults[selectedIdx]);
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    dropdown.style.display = 'none';
                    input.blur();
                }
            });

            if (clearBtn) {
                clearBtn.addEventListener('click', function () {
                    input.value = '';
                    clearBtn.style.display = 'none';
                    dropdown.style.display = 'none';
                    clearPinned();
                    input.focus();
                });
            }

            document.addEventListener('click', function (e) {
                if (!wrapper.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });
        }

        initGlobalSearch();
    }

    whenReady(function () {
        document.querySelectorAll('[data-amfm-app]').forEach(initMap);
    });
}());
