/*global google */
define([
    'dojo/_base/declare',
    'dijit/_WidgetBase',
    'dijit/_TemplatedMixin',
    'dijit/_WidgetsInTemplateMixin',
    'dojo/_base/lang',
    'dojo/aspect',
    'dojo/topic',
    'esri/layers/GraphicsLayer',
    'esri/graphic',
    'esri/renderers/SimpleRenderer',
    'esri/symbols/PictureMarkerSymbol',
    'dojo/dom-style',
    'esri/geometry/Point',
    'esri/SpatialReference',
    'dijit/MenuItem',

    'dojo/text!./templates/GoogleDirections.html',

    '//cdnjs.cloudflare.com/ajax/libs/proj4js/2.2.2/proj4.js',
    'dojo/i18n!./nls/resource',

    'dijit/form/Form',
    'dijit/form/Select',
    'dijit/form/Button',

    'xstyle/css!./css/GoogleDirections.css',
    'gis/plugins/async!//maps.google.com/maps/api/js?v=3&sensor=false'
], function (declare, _WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin, lang, aspect, topic, GraphicsLayer, Graphic, SimpleRenderer, PictureMarkerSymbol, domStyle, Point, SpatialReference, MenuItem, template, proj4, i18n) {
    return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
        widgetsInTemplate: true,
        templateString: template,
        i18n: i18n,
        mapClickMode: null,

        directionDisplay: null,
        directionsService: new google.maps.DirectionsService(),
        origin: null,
        destination: null,
        waypoints: [],
        markers: [],
        directionsVisible: false,

        defaultSymbols: {
            origin: {},
            destination: {},
            waypoint: {}
        },

        // in case this changes some day
        proj4BaseURL: 'http://spatialreference.org/',

        //  options are ESRI, EPSG and SR-ORG
        // See http://spatialreference.org/ for more information
        proj4Catalog: 'EPSG',

        // if desired, you can load a projection file from your server
        // instead of using one from spatialreference.org
        // i.e., http://server/projections/102642.js
        projCustomURL: null,

        postCreate: function () {
            this.inherited(arguments);
            this.createGraphicsLayers();

            if (this.parentWidget) {
                if (this.parentWidget.toggleable) {
                    this.own(aspect.after(this.parentWidget, 'toggle', lang.hitch(this, function () {
                        this.onLayoutChange(this.parentWidget.open);
                    })));
                }
            }

            /* This will handle a map click from a future UI
            this.map.on('click', lang.hitch(this, 'handleMapClick'));
            this.own(topic.subscribe('mapClickMode/currentSet', lang.hitch(this, 'setMapClickMode')));
            */

            // spatialreference.org uses the old
            // Proj4js style so we need an alias
            // https://github.com/proj4js/proj4js/issues/23
            window.Proj4js = proj4;

            if (this.mapRightClickMenu) {
                this.addRightClickMenu();
            }

        },
        createGraphicsLayers: function () {
            var symbols = lang.mixin({}, this.symbols);
            // handle each property to preserve as much of the object hierarchy as possible
            this.symbols = {
                origin: lang.mixin(this.defaultSymbols.origin, symbols.origin),
                destination: lang.mixin(this.defaultSymbols.destination, symbols.destination),
                waypoint: lang.mixin(this.defaultSymbols.waypoint, symbols.waypoint)
            };

            // origin, destination and way points
            this.pointGraphics = new GraphicsLayer({
                id: 'googleDrivingDirections_points',
                title: 'Google Driving Directions'
            });

            // poly line
            this.polylineGraphics = new GraphicsLayer({
                id: 'googleDrivingDirections_polyline',
                title: 'Google Driving Directions'
            });

            this.map.addLayer(this.pointGraphics);
            this.map.addLayer(this.polylineGraphics);
        },

        addRightClickMenu: function () {
            // capture map right click position
            this.map.on('MouseDown', lang.hitch(this, function (evt) {
                this.mapRightClickPoint = evt.mapPoint;
            }));

            this.menu = new Menu();
            this.menu.addChild(new MenuItem({
                label: this.i18n.labels.directionsFromHere,
                onClick: lang.hitch(this, 'directionsFrom')
            }));
            this.menu.addChild(new MenuItem({
                label: this.i18n.labels.directionsToHere,
                onClick: lang.hitch(this, 'directionsTo')
            }));
            this.menu.addChild(new MenuSeparator());
            this.menu.addChild(new MenuItem({
                label: this.i18n.labels.addStop,
                onClick: lang.hitch(this, 'addStop')
            }));
            this.menu.addChild(new MenuSeparator());
            this.menu.addChild(new MenuItem({
                label: this.i18n.labels.useMyLocationAsStart,
                onClick: lang.hitch(this, 'getGeoLocation', 'directionsFrom')
            }));
            this.menu.addChild(new MenuItem({
                label: this.i18n.labels.useMyLocationAsEnd,
                onClick: lang.hitch(this, 'getGeoLocation', 'directionsTo')
            }));

            // add this widgets menu as a sub menu to the map right click menu
            this.mapRightClickMenu.addChild(new PopupMenuItem({
                label: this.i18n.labels.directions,
                popup: this.menu
            }));
        },

        updateMode: function () {

        },

        clearDirections: function () {
            this.origin = null;
            this.destination = null;
            this.waypoints = [];
            this.pointGraphics.clear();
            this.polylineGraphics.clear();
            domStyle.set(this.googleDirectionsResultsDijit, 'display', 'none');
        },

        directionsFrom: function () {
            this.origin = this.mapRightClickPoint;
            var graphic = new Graphic(this.mapRightClickPoint, this.symbols.origin);
            this.pointGraphics.add(graphic);
            this.addMarker(this.origin);
            this.doRoute();
        },

        directionsTo: function () {
            this.destination = this.mapRightClickPoint;
            var graphic = new Graphic(this.mapRightClickPoint, this.symbols.destination);
            this.pointGraphics.add(graphic);
            this.doRoute();
        },

        addStop: function () {
            if (this.waypoints.length < 9) {
                this.waypoints.push(this.destination);
                this.destination = this.mapRightClickPoint;
                var graphic = new Graphic(this.mapRightClickPoint, this.symbols.waypoint);
                this.pointGraphics.add(graphic);
                this.doRoute();
            } else {
              alert("Maximum number of waypoints reached");
            }
        },

        /* This will handle a map click from a future UI
        handleMapClick: function (event) {
        },
        */

        doRoute: function () {
            // nothing to do so bail
            if (!this.origin || !this.destination) {
                return;
            }

            // toggle the titlepane if it isn't open already
            if (this.parentWidget && !this.parentWidget.open) {
                this.parentWidget.toggle();
            }

            // we'll do the route  here
        }
    });
});
