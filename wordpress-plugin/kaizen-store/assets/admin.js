/* Kaizen Store: the editor of a view. Plain JavaScript, no build step. */
( function () {
	'use strict';

	var data = window.KaizenStoreAdmin;
	var root = document.querySelector( '[data-kaizen-editor]' );
	if ( ! data || ! root ) {
		return;
	}
	var text = data.text;
	var config = data.config;
	var stores = [];
	var termsFor = '';
	var searchTimer = null;
	var picked = Array.isArray( config.products ) ? config.products.slice() : [];

	var $ = function ( selector, scope ) { return ( scope || root ).querySelector( selector ); };
	var all = function ( selector, scope ) { return Array.prototype.slice.call( ( scope || root ).querySelectorAll( selector ) ); };
	var storeSelect = $( '#kaizen-store' );
	var storeName = $( 'input[name="kaizen_view[store_name]"]' );
	var marketSelect = $( '#kaizen-market' );
	var errorBox = $( '.kaizen-error' );
	var productsField = $( '[data-products-field]' );

	function el( tag, attrs, children ) {
		var node = document.createElement( tag );
		Object.keys( attrs || {} ).forEach( function ( key ) {
			if ( key === 'text' ) {
				node.textContent = attrs[ key ];
			} else {
				node.setAttribute( key, attrs[ key ] );
			}
		} );
		( children || [] ).forEach( function ( child ) { node.appendChild( child ); } );
		return node;
	}

	function showError( message ) {
		errorBox.textContent = message || '';
		errorBox.hidden = ! message;
	}

	function call( action, fields ) {
		var body = new URLSearchParams();
		body.set( 'action', action );
		body.set( 'nonce', data.nonce );
		Object.keys( fields || {} ).forEach( function ( key ) { body.set( key, fields[ key ] ); } );
		return fetch( data.ajax, { method: 'POST', credentials: 'same-origin', body: body } )
			.then( function ( response ) { return response.json(); } )
			.then( function ( json ) {
				if ( ! json || ! json.success ) {
					throw new Error( json && json.data && json.data.message ? json.data.message : text.error );
				}
				return json.data;
			} );
	}

	function currentStore() {
		return storeSelect.value;
	}

	// The stores and, for the chosen one, its markets ---------------------------------------------------------------

	function fillStores() {
		storeSelect.innerHTML = '';
		storeSelect.appendChild( el( 'option', { value: '', text: text.chooseStore } ) );
		stores.forEach( function ( store ) {
			var option = el( 'option', { value: store.slug, text: store.name + ( store.open ? '' : ' ' + text.notOpen ) } );
			option.setAttribute( 'data-name', store.name );
			storeSelect.appendChild( option );
		} );
		storeSelect.value = config.store || '';
		if ( storeSelect.value !== ( config.store || '' ) ) {
			storeSelect.value = '';
		}
	}

	function fillMarkets() {
		var store = stores.filter( function ( item ) { return item.slug === currentStore(); } )[ 0 ];
		marketSelect.innerHTML = '';
		if ( ! store ) {
			marketSelect.appendChild( el( 'option', { value: '', text: text.chooseStore } ) );
			return;
		}
		if ( ! store.markets.length ) {
			marketSelect.appendChild( el( 'option', { value: '', text: text.noMarkets } ) );
			return;
		}
		store.markets.forEach( function ( market ) {
			marketSelect.appendChild( el( 'option', { value: market.slug, text: market.name + ' (' + market.currency + ', ' + market.language + ')' } ) );
		} );
		var wanted = config.market && store.markets.some( function ( market ) { return market.slug === config.market; } ) ? config.market : store.markets[ 0 ].slug;
		marketSelect.value = wanted;
	}

	// Categories and tags ------------------------------------------------------------------------------------------

	function fillTerms( terms ) {
		var boxes = { categories: $( '[data-terms="categories"]' ), tags: $( '[data-terms="tags"]' ) };
		[ 'categories', 'tags' ].forEach( function ( kind ) {
			var box = boxes[ kind ];
			box.innerHTML = '';
			var list = terms[ kind ] || [];
			if ( ! list.length ) {
				box.appendChild( el( 'p', { text: kind === 'categories' ? text.noCategories : text.noTags } ) );
				return;
			}
			list.forEach( function ( term ) {
				var input = el( 'input', { type: 'checkbox', name: 'kaizen_view[' + kind + '][]', value: term.id } );
				input.checked = ( config[ kind ] || [] ).indexOf( term.id ) !== -1;
				var label = el( 'label', {}, [ input, document.createTextNode( ' ' + ' '.repeat( term.depth || 0 ) + term.name ) ] );
				box.appendChild( label );
			} );
		} );
	}

	function loadTerms() {
		var store = currentStore();
		if ( ! store || store === termsFor ) {
			return;
		}
		termsFor = store;
		call( 'kaizen_store_terms', { store: store } ).then( fillTerms ).catch( function ( error ) { showError( error.message ); } );
	}

	// Products picked by hand --------------------------------------------------------------------------------------

	function savePicked() {
		productsField.value = JSON.stringify( picked );
	}

	function renderPicked() {
		var list = $( '[data-picked]' );
		list.innerHTML = '';
		if ( ! picked.length ) {
			list.appendChild( el( 'li', { text: text.nothingPicked } ) );
		}
		picked.forEach( function ( product, index ) {
			var up = el( 'button', { type: 'button', class: 'button button-small', 'aria-label': text.up + ': ' + product.title, text: '↑' } );
			var down = el( 'button', { type: 'button', class: 'button button-small', 'aria-label': text.down + ': ' + product.title, text: '↓' } );
			var remove = el( 'button', { type: 'button', class: 'button button-small', 'aria-label': text.remove + ': ' + product.title, text: text.remove } );
			up.disabled = index === 0;
			down.disabled = index === picked.length - 1;
			up.addEventListener( 'click', function () { move( index, -1 ); } );
			down.addEventListener( 'click', function () { move( index, 1 ); } );
			remove.addEventListener( 'click', function () { picked.splice( index, 1 ); renderPicked(); } );
			list.appendChild( el( 'li', {}, [ el( 'span', { text: product.title || product.id } ), up, down, remove ] ) );
		} );
		savePicked();
	}

	function move( index, by ) {
		var to = index + by;
		if ( to < 0 || to >= picked.length ) {
			return;
		}
		var item = picked.splice( index, 1 )[ 0 ];
		picked.splice( to, 0, item );
		renderPicked();
	}

	function renderResults( products ) {
		var list = $( '[data-pick-results]' );
		list.innerHTML = '';
		if ( ! products.length ) {
			list.appendChild( el( 'li', { text: text.noProducts } ) );
			return;
		}
		products.forEach( function ( product ) {
			var already = picked.some( function ( item ) { return item.id === product.id; } );
			var add = el( 'button', { type: 'button', class: 'button button-small', text: text.add, 'aria-label': text.add + ': ' + product.title } );
			add.disabled = already;
			add.addEventListener( 'click', function () {
				if ( picked.length < 48 ) {
					picked.push( { id: product.id, title: product.title } );
					add.disabled = true;
					renderPicked();
				}
			} );
			var children = [];
			if ( product.image ) {
				children.push( el( 'img', { class: 'kaizen-thumb', src: product.image, alt: '', width: 32, height: 32, loading: 'lazy' } ) );
			}
			children.push( el( 'span', { text: product.title } ), add );
			list.appendChild( el( 'li', {}, children ) );
		} );
	}

	function searchProducts() {
		var store = currentStore();
		if ( ! store ) {
			return;
		}
		call( 'kaizen_store_products', { store: store, q: $( '[data-pick-search]' ).value } )
			.then( function ( answer ) { renderResults( answer.products || [] ); } )
			.catch( function ( error ) { showError( error.message ); } );
	}

	// What shows for the chosen source and layout ----------------------------------------------------------------

	function source() {
		var checked = $( 'input[name="kaizen_view[source]"]:checked' );
		return checked ? checked.value : 'all';
	}

	function syncSource() {
		var current = source();
		all( '.kaizen-source' ).forEach( function ( box ) { box.hidden = box.getAttribute( 'data-source' ) !== current; } );
		$( '[data-sort-field]' ).hidden = current === 'products';
		if ( current === 'products' ) {
			renderPicked();
			searchProducts();
		}
	}

	// The preview ---------------------------------------------------------------------------------------------------

	function formConfig() {
		var form = {
			store: storeSelect.value,
			store_name: storeName.value,
			market: marketSelect.value,
			source: source(),
			categories: all( '[data-terms="categories"] input:checked' ).map( function ( input ) { return input.value; } ),
			tags: all( '[data-terms="tags"] input:checked' ).map( function ( input ) { return input.value; } ),
			products: picked,
			sort: $( '#kaizen-sort' ).value,
			limit: $( '#kaizen-limit' ).value,
			layout: $( 'input[name="kaizen_view[layout]"]:checked' ).value,
			columns: $( '#kaizen-columns' ).value,
			button_text: $( '#kaizen-button-text' ).value
		};
		[ 'show_price', 'show_excerpt', 'show_button', 'new_tab' ].forEach( function ( key ) {
			form[ key ] = $( 'input[name="kaizen_view[' + key + ']"]' ).checked ? 1 : 0;
		} );
		return form;
	}

	function preview() {
		var box = $( '[data-preview-box]' );
		if ( ! currentStore() ) {
			box.textContent = '';
			return;
		}
		box.textContent = text.previewing;
		call( 'kaizen_store_preview', { config: JSON.stringify( formConfig() ) } )
			.then( function ( answer ) {
				box.innerHTML = answer.html || '';
				if ( window.KaizenStoreCarousels ) {
					window.KaizenStoreCarousels( box );
				}
			} )
			.catch( function ( error ) { box.textContent = ''; showError( error.message ); } );
	}

	// Wiring ---------------------------------------------------------------------------------------------------------

	storeSelect.addEventListener( 'change', function () {
		var option = storeSelect.options[ storeSelect.selectedIndex ];
		storeName.value = option && option.getAttribute( 'data-name' ) ? option.getAttribute( 'data-name' ) : '';
		config.market = '';
		config.categories = [];
		config.tags = [];
		picked = [];
		termsFor = '';
		renderPicked();
		fillMarkets();
		loadTerms();
		searchProducts();
	} );
	all( 'input[name="kaizen_view[source]"]' ).forEach( function ( input ) { input.addEventListener( 'change', syncSource ); } );
	$( '[data-pick-search]' ).addEventListener( 'input', function () {
		clearTimeout( searchTimer );
		searchTimer = setTimeout( searchProducts, 300 );
	} );
	$( '[data-preview]' ).addEventListener( 'click', preview );

	var codes = document.querySelectorAll( 'code.kaizen-copy, input.kaizen-copy' );
	Array.prototype.forEach.call( codes, function ( code ) {
		code.addEventListener( 'click', function () {
			if ( code.select ) {
				code.select();
			}
		} );
	} );

	storeSelect.disabled = true;
	call( 'kaizen_store_stores' )
		.then( function ( answer ) {
			stores = answer.stores || [];
			fillStores();
			fillMarkets();
			storeSelect.disabled = false;
			loadTerms();
			syncSource();
			if ( currentStore() ) {
				preview();
			}
		} )
		.catch( function ( error ) { storeSelect.disabled = false; showError( error.message ); } );
} )();
