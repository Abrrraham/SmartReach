import MaplibreGl, { FlyToOptions, Marker, Popup, MarkerOptions, Map } from 'maplibre-gl';

/**
 * A Carmen GeoJSON Feature.
 * @see https://web.archive.org/web/20210224184722/https://github.com/mapbox/carmen/blob/master/carmen-geojson.md
 */
type CarmenGeojsonFeature = GeoJSON.Feature & {
    id: string;
    /**
     * Text representing the feature (e.g. "Austin").
     */
    text: string;
    /**
     * Optional. The language code of the text returned in text.
     */
    language?: string;
    /**
     * Human-readable text representing the full result hierarchy (e.g. "Austin, Texas, United States").
     */
    place_name: string;
    /**
     * An array of index types that this feature may be returned as. Most features have only one type matching its id.
     */
    place_type: string[];
    /**
     * Optional. Array bounding box of the form [minx,miny,maxx,maxy].
     */
    bbox?: [number, number, number, number];
};
type MaplibreGeocoderOptions = {
    /**
     * On geocoded result what zoom level should the map animate to when a `bbox` isn't found in the response. If a `bbox` is found the map will fit to the `bbox`.
     * @default 16
     */
    zoom?: number;
    /**
     * If `false`, animating the map to a selected result is disabled. If `true`, animating the map will use the default animation parameters. If an object, it will be passed as `options` to the map [`flyTo`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map#flyto) or [`fitBounds`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map#map#fitbounds) method providing control over the animation of the transition.
     * @default true
     */
    flyTo?: boolean | FlyToOptions;
    /**
     * If `true`, the geocoder proximity will automatically update based on the map view.
     * @default true
     */
    trackProximity?: boolean;
    /**
     * If `false`, indicates that search will only occur on enter key press. If `true`, indicates that the Geocoder will search on the input box being updated above the minLength option.
     * @default false
     */
    showResultsWhileTyping?: boolean;
    /**
     * Minimum number of characters to enter before results are shown.
     * @default 2
     */
    minLength?: number;
    /**
     * If `true`, enable reverse geocoding mode. In reverse geocoding, search input is expected to be coordinates in the form `lat, lon`, with suggestions being the reverse geocodes.
     * @default false
     */
    reverseGeocode?: boolean;
    /**
     * Maximum number of results to show.
     * @default 5
     */
    limit?: number;
    /**
     * Allow Maplibre to collect anonymous usage statistics from the plugin.
     * @default true
     */
    enableEventLogging?: boolean;
    /**
     * If `true`, a [Marker](https://maplibre.org/maplibre-gl-js/docs/API/classes/Marker/) will be added to the map at the location of the user-selected result using a default set of Marker options.  If the value is an object, the marker will be constructed using these options. If `false`, no marker will be added to the map. Requires that `options.maplibregl` also be set.
     * @default true
     */
    marker?: boolean | Marker;
    /**
     * If `true`, a [Popup](https://maplibre.org/maplibre-gl-js/docs/API/classes/Popup) will be added to the map when clicking on a marker using a default set of popup options.  If the value is an object, the popup will be constructed using these options. If `false`, no popup will be added to the map. Requires that `options.maplibregl` also be set.
     * @default false
     */
    popup?: boolean | Popup;
    /**
     * A [maplibre-gl](https://github.com/maplibre/maplibre-gl-js) instance to use when creating [Markers](https://maplibre.org/maplibre-gl-js/docs/API/classes/Marker/). Required if `options.marker` is `true`.
     * @default false
     */
    maplibregl?: typeof MaplibreGl;
    /**
     * If `true`, the geocoder control will collapse until hovered or in focus.
     * @default false
     */
    collapsed?: boolean;
    /**
     * If `true`, the geocoder control will clear it's contents and blur when user presses the escape key.
     * @default false
     */
    clearAndBlurOnEsc?: boolean;
    /**
     * If `true`, the geocoder control will clear its value when the input blurs.
     * @default false
     */
    clearOnBlur?: boolean;
    /**
     * If `true`, indicates that the `localGeocoder` results should be the only ones returned to the user. If `false`, indicates that the `localGeocoder` results should be combined with those from the Maplibre API with the `localGeocoder` results ranked higher.
     * @default false
     */
    localGeocoderOnly?: boolean;
    /**
     * Sets the amount of time, in milliseconds, to wait before querying the server when a user types into the Geocoder input box. This parameter may be useful for reducing the total number of API calls made for a single query.
     * @default 200
     */
    debounceSearch?: number;
    /**
     * If `true`, [Markers](https://maplibre.org/maplibre-gl-js/docs/API/classes/Marker/) will be added to the map at the location the top results for the query. If the value is an object, the marker will be constructed using these options. If `false`, no marker will be added to the map. Requires that `options.maplibregl` also be set.
     * @default true
     */
    showResultMarkers?: boolean | MarkerOptions;
    /**
     * Specify the language to use for response text and query result weighting. Options are IETF language tags comprised of a mandatory ISO 639-1 language code and optionally one or more IETF subtags for country or script. More than one value can also be specified, separated by commas. Defaults to the browser's language settings.
     */
    language?: string;
    /**
     * Override the default placeholder attribute value.
     * @default "Search"
     */
    placeholder?: string;
    /**
     * a proximity argument: this is a geographical point given as an object with `latitude` and `longitude` properties.
     * Search results closer to this point will be given higher priority.
     */
    proximity?: {
        longitude: number;
        latitude: number;
    };
    /**
     * A comma seperated list of types that filter results to match those specified. See https://docs.mapbox.com/api/search/#data-types for available types.
     * If reverseGeocode is enabled, you should specify one type. If you configure more than one type, the first type will be used.
     */
    types?: string;
    /**
     * A comma separated list of country codes to limit results to specified country or countries.
     */
    countries?: string;
    /**
     * A bounding box argument: this is a bounding box given as an array in the format `[minX, minY, maxX, maxY]`.
     * Search results will be limited to the bounding box.
     */
    bbox?: number[];
    /**
     * Set the factors that are used to sort nearby results.
     */
    reverseMode?: "distance" | "score";
    /**
     * If setting promiximity, this is the minimum zoom level at which to start taking it into account.
     * @default 9
     */
    proximityMinZoom?: number;
    /**
     * A function that specifies how the selected result should be rendered in the search bar. HTML tags in the output string will not be rendered. Defaults to `(item) => item.place_name`.
     * @example
     *
     * const GeoApi = {
     *   forwardGeocode: (config) => { return { features: [] } },
     *   reverseGeocode: (config) => { return { features: [] } }
     *   getSuggestions: (config) => { return { suggestions: {text: string, placeId?: string}[] }}
     *   searchByPlaceId: (config) => { return { place: {type: string, geometry: {type: string, coordinates: [number]} place_name: string, text: string, center: [number] }[] }}
     * }
     * const geocoder = new MaplibreGeocoder(GeoApi, {});
     * map.addControl(geocoder);
     */
    getItemValue?: (item: CarmenGeojsonFeature) => string;
    /**
     * A function that specifies how the results should be rendered in the dropdown menu. Any HTML in the returned string will be rendered.
     */
    render?: (item: CarmenGeojsonFeature) => string;
    /**
     * A function that specifies how the results should be rendered in the popup menu. Any HTML in the returned string will be rendered.
     */
    popupRender?: (item: CarmenGeojsonFeature) => string;
    /**
     * A function accepting the query string which performs local geocoding to supplement results from the Maplibre Geocoding API. Expected to return an Array of {@link CarmenGeojsonFeature}.
     */
    localGeocoder?: (query: string) => CarmenGeojsonFeature[];
    /**
     * A function accepting the query string, current features list, and geocoder options which performs geocoding to supplement results from the Maplibre Geocoding API. Expected to return a Promise which resolves to an Array of {@link CarmenGeojsonFeature}.
     */
    externalGeocoder?: (query: string, features: CarmenGeojsonFeature[], confic: MaplibreGeocoderApiConfig) => Promise<CarmenGeojsonFeature[]>;
    /**
     * A function which accepts a {@link CarmenGeojsonFeature} to filter out results from the Geocoding API response before they are included in the suggestions list. Return `true` to keep the item, `false` otherwise.
     */
    filter?: (item: CarmenGeojsonFeature) => boolean;
};
type MaplibreGeocoderApiConfig = {
    /**
     * A comma separated list of country codes to limit results to specified country or countries.
     */
    countries?: string;
    /**
     * A comma seperated list of types that filter results to match those specified. See https://docs.mapbox.com/api/search/#data-types for available types. If reverseGeocode is enabled, you should specify one type. If you configure more than one type, the first type will be used.
     */
    types?: string;
    /**
     * Specify the language to use for response text and query result weighting. Options are IETF language tags comprised of a mandatory ISO 639-1 language code and optionally one or more IETF subtags for country or script. More than one value can also be specified, separated by commas. Defaults to the browser's language settings.
     */
    language?: string;
    /**
     * A bounding box given as an array in the format `[minX, minY, maxX, maxY]`. Search results will be limited to the bounding box.
     */
    bbox?: number[];
    /**
     * Number of results to limit by
     */
    limit?: number;
    /**
     * A geographical point given as an object with `latitude` and `longitude` properties. Search results closer to this point will be given higher priority.
     */
    proximity?: number[];
    /**
     * Set the factors that are used to sort nearby results.
     */
    reverseMode?: "distance" | "score";
    /**
     * Search query string
     */
    query?: string | number[];
};
type MaplibreGeocoderFeatureResults = {
    type: "FeatureCollection";
    features: CarmenGeojsonFeature[];
};
type MaplibreGeocoderSuggestionResults = {
    suggestions: {
        text: string;
        placeId?: string;
    }[];
};
type MaplibreGeocoderPlaceResults = {
    place: CarmenGeojsonFeature[];
};
type MaplibreGeocoderResults = MaplibreGeocoderFeatureResults | MaplibreGeocoderSuggestionResults | MaplibreGeocoderPlaceResults;
/**
 * An API which contains reverseGeocode and forwardGeocode functions to be used by this plugin
 */
type MaplibreGeocoderApi = {
    /**
     * Forward geocode function should return an object including a collection of {@link CarmenGeojsonFeature}.
     * @param config - Query parameters
     */
    forwardGeocode: (config: MaplibreGeocoderApiConfig) => Promise<MaplibreGeocoderFeatureResults>;
    /**
     * Reverse geocode function should return an object including a collection of {@link CarmenGeojsonFeature}.
     */
    reverseGeocode?: (config: MaplibreGeocoderApiConfig) => Promise<MaplibreGeocoderFeatureResults>;
    getSuggestions?: (config: MaplibreGeocoderApiConfig) => Promise<MaplibreGeocoderSuggestionResults>;
    searchByPlaceId?: (config: MaplibreGeocoderApiConfig) => Promise<MaplibreGeocoderPlaceResults>;
};
/**
 * A geocoder component that works with maplibre
 */
declare class MaplibreGeocoder {
    private options;
    private _eventEmitter;
    private _map;
    private _maplibregl;
    private _inputEl;
    private _clearEl;
    private _loadingEl;
    private _typeahead;
    private container;
    private mapMarker;
    private resultMarkers;
    private placeholder;
    private fresh;
    private lastSelected;
    private geocoderApi;
    constructor(geocoderApi: MaplibreGeocoderApi, options: MaplibreGeocoderOptions);
    /**
     * Add the geocoder to a container. The container can be either a `Map`, an `HTMLElement` or a CSS selector string.
     *
     * If the container is a [`Map`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map), this function will behave identically to [`Map.addControl(geocoder)`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map#addcontrol).
     * If the container is an instance of [`HTMLElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement), then the geocoder will be appended as a child of that [`HTMLElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement).
     * If the container is a [CSS selector string](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors), the geocoder will be appended to the element returned from the query.
     *
     * This function will throw an error if the container is none of the above.
     * It will also throw an error if the referenced HTML element cannot be found in the `document.body`.
     *
     * For example, if the HTML body contains the element `<div id='geocoder-container'></div>`, the following script will append the geocoder to `#geocoder-container`:
     * @example
     * ```js
     * const GeoApi = {
     *   forwardGeocode: (config) => { return { features: [] } },
     *   reverseGeocode: (config) => { return { features: [] } }
     * }
     * const geocoder = new MaplibreGeocoder(GeoAPI, {});
     * geocoder.addTo('#geocoder-container');
     * ```
     * @param container - A reference to the container to which to add the geocoder
     */
    addTo(container: string | HTMLElement | Map): void;
    onAdd(map?: Map): HTMLElement;
    createIcon(name: string, path: string): SVGSVGElement;
    onRemove(): this;
    _onPaste(e: any): void;
    _onKeyDown(e: any): void | "none";
    _showButton(): void;
    _hideButton(): void;
    _onBlur(e: any): void;
    _onChange(): void;
    _getConfigForRequest(): MaplibreGeocoderApiConfig;
    _geocode(searchInput: string, isSuggestion?: boolean, isPlaceId?: boolean): Promise<MaplibreGeocoderResults>;
    private _createGeocodeRequest;
    private _createReverseGeocodeRequest;
    private _handleGeocodeResponse;
    private _handleGeocodeErrorResponse;
    /**
     * Shared logic for clearing input
     * @param ev - the event that triggered the clear, if available
     */
    private _clear;
    /**
     * Clear and then focus the input.
     * @param ev - the event that triggered the clear, if available
     *
     */
    clear(ev?: Event): void;
    /**
     * Clear the input, without refocusing it. Used to implement clearOnBlur
     * constructor option.
     * @param ev - the blur event
     */
    private _clearOnBlur;
    _onQueryResult(results: MaplibreGeocoderResults): void;
    _updateProximity(): void;
    _collapse(): void;
    _unCollapse(): void;
    /**
     * Set & query the input
     * @param searchInput - location name or other search input
     */
    query(searchInput: string): Promise<void>;
    _renderError(): void;
    _renderNoResults(): void;
    _renderMessage(msg: any): void;
    /**
     * Get a localised string for a given key
     *
     * If language is provided in options, attempt to return localized string (defaults to English)
     * @param key - key in the localization object
     * @returns localized string
     */
    private _localize;
    /**
     * Fits the map to the current bounds for the searched results
     */
    private _fitBoundsForMarkers;
    /**
     * Set input
     * @param searchInput - location name or other search input
     */
    setInput(searchInput: string): this;
    /**
     * Set proximity
     * @param proximity - The new `options.proximity` value. This is a geographical point given as an object with `latitude` and `longitude` properties.
     */
    setProximity(proximity: {
        longitude: number;
        latitude: number;
    }): this;
    /**
     * Get proximity
     * @returns The geocoder proximity
     */
    getProximity(): {
        longitude: number;
        latitude: number;
    };
    /**
     * Set the render function used in the results dropdown
     * @param fn - The function to use as a render function. This function accepts a single {@link CarmenGeojsonFeature} object as input and returns a string.
     */
    setRenderFunction(fn: (feature: CarmenGeojsonFeature) => string): this;
    /**
     * Get the function used to render the results dropdown
     *
     * @returns the render function
     */
    getRenderFunction(): (feature: CarmenGeojsonFeature) => string;
    /**
     * Get the language to use in UI elements and when making search requests
     *
     * Look first at the explicitly set options otherwise use the browser's language settings
     * @param language - Specify the language to use for response text and query result weighting. Options are IETF language tags comprised of a mandatory ISO 639-1 language code and optionally one or more IETF subtags for country or script. More than one value can also be specified, separated by commas.
     */
    setLanguage(language?: string): this;
    /**
     * Get the language to use in UI elements and when making search requests
     * @returns The language(s) used by the plugin, if any
     */
    getLanguage(): string;
    /**
     * Get the zoom level the map will move to when there is no bounding box on the selected result
     * @returns the map zoom
     */
    getZoom(): number;
    /**
     * Set the zoom level
     * @param zoom - The zoom level that the map should animate to when a `bbox` isn't found in the response. If a `bbox` is found the map will fit to the `bbox`.
     * @returns this
     */
    setZoom(zoom: number): this;
    /**
     * Get the parameters used to fly to the selected response, if any
     * @returns The `flyTo` option
     */
    getFlyTo(): boolean | FlyToOptions;
    /**
     * Set the flyTo options
     * @param flyTo - If false, animating the map to a selected result is disabled. If true, animating the map will use the default animation parameters. If an object, it will be passed as `options` to the map [`flyTo`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map#flyto) or [`fitBounds`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map#fitbounds) method providing control over the animation of the transition.
     */
    setFlyTo(flyTo: boolean | FlyToOptions): this;
    /**
     * Get the value of the placeholder string
     * @returns The input element's placeholder value
     */
    getPlaceholder(): string;
    /**
     * Set the value of the input element's placeholder
     * @param placeholder - the text to use as the input element's placeholder
     */
    setPlaceholder(placeholder?: string): this;
    /**
     * Get the bounding box used by the plugin
     * @returns the bounding box, if any
     */
    getBbox(): number[];
    /**
     * Set the bounding box to limit search results to
     * @param bbox - a bounding box given as an array in the format [minX, minY, maxX, maxY].
     */
    setBbox(bbox: [number, number, number, number]): this;
    /**
     * Get a list of the countries to limit search results to
     * @returns a comma separated list of countries to limit to, if any
     */
    getCountries(): string;
    /**
     * Set the countries to limit search results to
     * @param countries - a comma separated list of countries to limit to
     */
    setCountries(countries: string): this;
    /**
     * Get a list of the types to limit search results to
     * @returns a comma separated list of types to limit to
     */
    getTypes(): string;
    /**
     * Set the types to limit search results to
     * @param types - a comma separated list of types to limit to
     */
    setTypes(types: string): this;
    /**
     * Get the minimum number of characters typed to trigger results used in the plugin
     * @returns The minimum length in characters before a search is triggered
     */
    getMinLength(): number;
    /**
     * Set the minimum number of characters typed to trigger results used by the plugin
     * @param minLength - the minimum length in characters
     */
    setMinLength(minLength: number): this;
    /**
     * Get the limit value for the number of results to display used by the plugin
     * @returns The limit value for the number of results to display used by the plugin
     */
    getLimit(): number;
    /**
     * Set the limit value for the number of results to display used by the plugin
     * @param limit - the number of search results to return
     */
    setLimit(limit: number): this;
    /**
     * Get the filter function used by the plugin
     * @returns the filter function
     */
    getFilter(): (feature: CarmenGeojsonFeature) => boolean;
    /**
     * Set the filter function used by the plugin.
     * @param filter - A function which accepts a {@link CarmenGeojsonFeature} to filter out results from the Geocoding API response before they are included in the suggestions list. Return `true` to keep the item, `false` otherwise.
     */
    setFilter(filter: (feature: CarmenGeojsonFeature) => boolean): this;
    /**
     * Set the geocoding api used by the plugin.
     */
    setGeocoderApi(geocoderApi: MaplibreGeocoderApi): this;
    /**
     * Get the geocoding endpoint the plugin is currently set to
     * @returns the geocoding API
     */
    getGeocoderApi(): MaplibreGeocoderApi;
    /**
     * Handle the placement of a result marking the selected result
     * @param selected - the selected geojson feature
     */
    private _handleMarker;
    /**
     * Handle the removal of a result marker
     */
    private _removeMarker;
    /**
     * Handle the placement of a result marking the selected result
     * @param results - the top results to display on the map
     */
    private _handleResultMarkers;
    /**
     * Handle the removal of a result marker
     */
    private _removeResultMarkers;
    /**
     * Subscribe to events that happen within the plugin.
     * @param type - name of event. Available events and the data passed into their respective event objects are:
     *
     * - __clear__ `Emitted when the input is cleared`
     * - __loading__ `{ query } Emitted when the geocoder is looking up a query`
     * - __results__ `{ results } Fired when the geocoder returns a response`
     * - __result__ `{ result } Fired when input is set`
     * - __error__ `{ error } Error as string`
     * @param fn - function that's called when the event is emitted.
     */
    on(type: string, fn: (e: any) => void): this;
    /**
     * Subscribe to events that happen within the plugin only once.
     * @param type - Event name.
     * Available events and the data passed into their respective event objects are:
     *
     * - __clear__ `Emitted when the input is cleared`
     * - __loading__ `{ query } Emitted when the geocoder is looking up a query`
     * - __results__ `{ results } Fired when the geocoder returns a response`
     * - __result__ `{ result } Fired when input is set`
     * - __error__ `{ error } Error as string`
     * @returns a Promise that resolves when the event is emitted.
     */
    once(type: string): Promise<any>;
    /**
     * Remove an event
     * @param type - Event name.
     * @param fn - Function that should unsubscribe to the event emitted.
     */
    off(type: string, fn: (e: any) => void): this;
}

export { MaplibreGeocoder as default };
export type { CarmenGeojsonFeature, MaplibreGeocoderApi, MaplibreGeocoderApiConfig, MaplibreGeocoderFeatureResults, MaplibreGeocoderOptions, MaplibreGeocoderPlaceResults, MaplibreGeocoderResults, MaplibreGeocoderSuggestionResults };
