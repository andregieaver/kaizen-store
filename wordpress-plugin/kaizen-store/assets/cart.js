/*
 * Kaizen Store: the slide-out cart and the product page's choices. Plain JavaScript, no build step.
 *
 * The cart lives in this browser (localStorage) until the shopper presses Checkout: this site then asks Kaizen to make the same cart in the
 * store and sends the shopper there, where the checkout, shipping, discounts and payment happen. Prices, stock and words always come from
 * Kaizen (through this site's REST route); nothing is worked out here but sums of what Kaizen said.
 */
( function () {
	'use strict';

	var cfg = window.KaizenStoreCart;
	if ( ! cfg ) {
		return;
	}
	var KEY = 'kaizen_cart_v1';
	var MAX_QTY = 20;
	var text = cfg.text || {};
	var DEFAULT_LABELS = {
		cart: text.cart || 'Cart',
		close: text.close || 'Close',
		quantity: 'Quantity',
		remove: 'Remove',
		subtotal: 'Subtotal',
		emptyCart: 'The cart is empty.',
		shippingAtCheckout: 'Shipping, discounts and VAT are worked out at checkout.',
		checkout: 'Checkout',
		continueShopping: 'Continue shopping',
		noLongerAvailable: 'No longer available. Remove it to continue.',
		onlyAvailable: 'Only {n} available. The quantity was changed.',
		outOfStock: 'Sold out',
		inStock: 'In stock',
		lowStock: 'Only {n} left',
		added: 'Added to the cart.',
		tryAgain: text.error || 'Something went wrong. Try again.'
	};

	var state = load();
	var quote = null;
	var timer = null;
	var panel = null;
	var opener = null;
	var busy = false;

	// ---- storage -------------------------------------------------------------------------------------------------------

	function empty() {
		return { store: '', market: '', lines: [], labels: null, at: 0 };
	}

	function load() {
		try {
			var raw = window.localStorage.getItem( KEY );
			var value = raw ? JSON.parse( raw ) : null;
			if ( value && Array.isArray( value.lines ) && typeof value.store === 'string' ) {
				// A cart nobody touched for a week is forgotten.
				if ( value.at && Date.now() - value.at > 7 * 24 * 3600 * 1000 ) {
					return empty();
				}
				return value;
			}
		} catch ( e ) { /* private mode: the cart lives only on this page */ }
		return empty();
	}

	function save() {
		state.at = Date.now();
		try {
			window.localStorage.setItem( KEY, JSON.stringify( state ) );
		} catch ( e ) { /* ignored */ }
	}

	function labels() {
		var base = {};
		var from = ( quote && quote.labels ) || state.labels || {};
		Object.keys( DEFAULT_LABELS ).forEach( function ( key ) { base[ key ] = from[ key ] || DEFAULT_LABELS[ key ]; } );
		return base;
	}

	function count() {
		return state.lines.reduce( function ( total, line ) { return total + line.q; }, 0 );
	}

	// ---- small DOM helpers ---------------------------------------------------------------------------------------------

	function el( tag, attrs, children ) {
		var node = document.createElement( tag );
		Object.keys( attrs || {} ).forEach( function ( key ) {
			if ( key === 'text' ) {
				node.textContent = attrs[ key ];
			} else {
				node.setAttribute( key, attrs[ key ] );
			}
		} );
		( children || [] ).forEach( function ( child ) { if ( child ) { node.appendChild( child ); } } );
		return node;
	}

	function priceNodes( price ) {
		var out = document.createDocumentFragment();
		if ( ! price || ! price.text ) {
			return out;
		}
		var now = el( 'span', { 'class': 'kaizen-price-now' } );
		if ( price.from_label ) {
			now.appendChild( el( 'span', { 'class': 'kaizen-from', text: price.from_label } ) );
			now.appendChild( document.createTextNode( ' ' ) );
		}
		now.appendChild( el( 'span', { 'class': 'kaizen-amount', text: price.text } ) );
		if ( price.vat_label ) {
			now.appendChild( document.createTextNode( ' ' ) );
			now.appendChild( el( 'span', { 'class': 'kaizen-vat', text: price.vat_label } ) );
		}
		out.appendChild( now );
		if ( price.prior_text && price.prior_label ) {
			out.appendChild( el( 'span', { 'class': 'kaizen-price-prior' }, [ document.createTextNode( price.prior_label + ': ' ), el( 'span', { text: price.prior_text } ) ] ) );
		}
		if ( price.unit_text ) {
			out.appendChild( el( 'span', { 'class': 'kaizen-unit', text: price.unit_text } ) );
		}
		return out;
	}

	// ---- the cart's changes --------------------------------------------------------------------------------------------

	function findLine( variant ) {
		for ( var i = 0; i < state.lines.length; i++ ) {
			if ( state.lines[ i ].v === variant ) {
				return state.lines[ i ];
			}
		}
		return null;
	}

	/** Puts a variant in the cart; a cart holds one store and market (the store's own cart does), so another starts a new one after asking. */
	function add( item, qty, shopLabels ) {
		if ( state.lines.length && ( state.store !== item.store || state.market !== item.market ) ) {
			if ( ! window.confirm( text.replace || 'Start a new cart?' ) ) {
				return;
			}
			state = empty();
			quote = null;
		}
		state.store = item.store;
		state.market = item.market;
		if ( shopLabels ) {
			state.labels = shopLabels;
		}
		var line = findLine( item.variant );
		if ( line ) {
			line.q = Math.min( MAX_QTY, line.q + qty );
		} else {
			state.lines.push( { v: item.variant, q: Math.min( MAX_QTY, qty ), t: item.title || '', i: item.image || '', p: item.price || '', u: item.url || '' } );
		}
		save();
		render();
		openCart( document.activeElement );
		schedule();
	}

	function setQty( variant, q ) {
		var line = findLine( variant );
		if ( ! line ) {
			return;
		}
		if ( q < 1 ) {
			remove( variant );
			return;
		}
		line.q = Math.min( MAX_QTY, q );
		save();
		render();
		schedule();
	}

	function remove( variant ) {
		state.lines = state.lines.filter( function ( line ) { return line.v !== variant; } );
		if ( ! state.lines.length ) {
			state = empty();
			quote = null;
		}
		save();
		render();
		schedule();
	}

	// ---- the live prices -----------------------------------------------------------------------------------------------

	function schedule() {
		clearTimeout( timer );
		timer = setTimeout( refresh, 200 );
	}

	function post( route, body ) {
		return fetch( cfg.rest + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( body ) } )
			.then( function ( response ) {
				return response.json().then( function ( json ) { return { status: response.status, json: json }; } );
			} );
	}

	function body() {
		return {
			store: state.store,
			market: state.market,
			lines: state.lines.map( function ( line ) { return { variant_id: line.v, quantity: line.q }; } )
		};
	}

	function refresh() {
		if ( ! state.lines.length ) {
			return;
		}
		status( labels().loading || text.loading || '' );
		var sent = body();
		post( 'quote', sent ).then( function ( answer ) {
			if ( answer.status !== 200 || ! answer.json.lines ) {
				status( ( answer.json && answer.json.error && answer.json.error.message ) || labels().tryAgain );
				return;
			}
			if ( JSON.stringify( sent ) !== JSON.stringify( body() ) ) {
				return; // the cart changed while asking: the newer answer will follow
			}
			quote = answer.json;
			state.labels = quote.labels;
			var notes = [];
			quote.lines.forEach( function ( line, i ) {
				var mine = state.lines[ i ];
				if ( ! mine ) {
					return;
				}
				if ( line.status === 'insufficient' ) {
					mine.q = Math.max( 1, line.available );
					notes.push( labels().onlyAvailable.replace( '{n}', String( line.available ) ) + ' ' + line.title );
				}
			} );
			save();
			render();
			status( notes.join( ' ' ) );
		} ).catch( function () {
			status( labels().tryAgain );
		} );
	}

	function status( message ) {
		if ( panel ) {
			panel.querySelector( '.kaizen-cart-status' ).textContent = message || '';
		}
	}

	// ---- the drawer ----------------------------------------------------------------------------------------------------

	function build() {
		if ( panel ) {
			return;
		}
		var lang = labels();
		var root = el( 'div', { 'class': 'kaizen-cart', hidden: '', 'data-kaizen-cart': '' } );
		var backdrop = el( 'div', { 'class': 'kaizen-cart-backdrop', 'data-kaizen-close': '' } );
		var aside = el( 'aside', { 'class': 'kaizen-cart-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kaizen-cart-title', tabindex: '-1' } );
		var header = el( 'header', { 'class': 'kaizen-cart-header' }, [
			el( 'h2', { id: 'kaizen-cart-title', text: lang.cart } ),
			el( 'button', { type: 'button', 'class': 'kaizen-cart-close', 'data-kaizen-close': '', 'aria-label': lang.close }, [ el( 'span', { 'aria-hidden': 'true', text: '×' } ) ] )
		] );
		var lines = el( 'ul', { 'class': 'kaizen-cart-lines', role: 'list' } );
		var emptyText = el( 'p', { 'class': 'kaizen-cart-empty', text: lang.emptyCart } );
		var footer = el( 'footer', { 'class': 'kaizen-cart-footer' }, [
			el( 'p', { 'class': 'kaizen-cart-subtotal' }, [ el( 'span', { 'data-label': 'subtotal', text: lang.subtotal } ), el( 'strong', { 'data-subtotal': '' } ) ] ),
			el( 'p', { 'class': 'kaizen-cart-note', 'data-label': 'shippingAtCheckout', text: lang.shippingAtCheckout } ),
			el( 'button', { type: 'button', 'class': 'kaizen-add kaizen-add--large kaizen-checkout', 'data-kaizen-checkout': '', text: lang.checkout } ),
			el( 'button', { type: 'button', 'class': 'kaizen-cart-continue', 'data-kaizen-close': '', text: lang.continueShopping } )
		] );
		aside.appendChild( header );
		aside.appendChild( el( 'div', { 'class': 'kaizen-cart-status', role: 'status', 'aria-live': 'polite' } ) );
		aside.appendChild( lines );
		aside.appendChild( emptyText );
		aside.appendChild( footer );
		root.appendChild( backdrop );
		root.appendChild( aside );
		document.body.appendChild( root );
		panel = root;
		root.addEventListener( 'click', function ( event ) {
			var target = event.target;
			if ( target.closest( '[data-kaizen-close]' ) ) {
				closeCart();
			} else if ( target.closest( '[data-kaizen-checkout]' ) ) {
				checkout();
			}
		} );
		root.addEventListener( 'keydown', trap );
	}

	function lineNode( line, info ) {
		var lang = labels();
		var item = el( 'li', { 'class': 'kaizen-cart-line' + ( info && info.status === 'unavailable' ? ' is-unavailable' : '' ) } );
		var image = ( info && info.image && info.image.url ) || line.i;
		if ( image ) {
			item.appendChild( el( 'img', { 'class': 'kaizen-cart-image', src: image, alt: '', width: '64', height: '64', loading: 'lazy' } ) );
		} else {
			item.appendChild( el( 'span', { 'class': 'kaizen-cart-image' } ) );
		}
		var title = ( info && info.title ) || line.t;
		var link = ( info && info.url ) || line.u;
		var options = info && info.options ? Object.keys( info.options ).map( function ( key ) { return info.options[ key ]; } ).join( ' / ' ) : '';
		var main = el( 'div', { 'class': 'kaizen-cart-main' } );
		main.appendChild( link ? el( 'a', { 'class': 'kaizen-cart-title', href: link, text: title } ) : el( 'span', { 'class': 'kaizen-cart-title', text: title } ) );
		if ( options ) {
			main.appendChild( el( 'span', { 'class': 'kaizen-cart-options', text: options } ) );
		}
		var unit = info && info.unit ? info.unit.text : line.p;
		if ( unit ) {
			main.appendChild( el( 'span', { 'class': 'kaizen-cart-unit', text: unit } ) );
		}
		if ( info && info.status === 'unavailable' ) {
			main.appendChild( el( 'span', { 'class': 'kaizen-cart-problem', text: lang.noLongerAvailable } ) );
		}
		var minus = el( 'button', { type: 'button', 'class': 'kaizen-step', 'aria-label': lang.quantity + ' − ' + title, text: '−' } );
		var plus = el( 'button', { type: 'button', 'class': 'kaizen-step', 'aria-label': lang.quantity + ' + ' + title, text: '+' } );
		var max = info && info.status !== 'unavailable' && info.available ? Math.min( MAX_QTY, info.available ) : MAX_QTY;
		plus.disabled = line.q >= max;
		minus.addEventListener( 'click', function () { setQty( line.v, line.q - 1 ); } );
		plus.addEventListener( 'click', function () { setQty( line.v, line.q + 1 ); } );
		var stepper = el( 'div', { 'class': 'kaizen-stepper', role: 'group', 'aria-label': lang.quantity + ': ' + title }, [ minus, el( 'output', { text: String( line.q ) } ), plus ] );
		var removeButton = el( 'button', { type: 'button', 'class': 'kaizen-cart-remove', 'data-focus': 'remove:' + line.v, 'aria-label': lang.remove + ': ' + title, text: lang.remove } );
		removeButton.addEventListener( 'click', function () { remove( line.v ); } );
		main.appendChild( el( 'div', { 'class': 'kaizen-cart-controls' }, [ info && info.status === 'unavailable' ? null : stepper, removeButton ] ) );
		item.appendChild( main );
		if ( info && info.line_text && info.status !== 'unavailable' ) {
			item.appendChild( el( 'span', { 'class': 'kaizen-cart-total', text: info.line_text } ) );
		}
		return item;
	}

	function render() {
		renderButton();
		if ( ! panel ) {
			return;
		}
		var lang = labels();
		panel.querySelector( '#kaizen-cart-title' ).textContent = lang.cart + ( count() ? ' (' + count() + ')' : '' );
		panel.querySelector( '[data-label="subtotal"]' ).textContent = lang.subtotal;
		panel.querySelector( '[data-label="shippingAtCheckout"]' ).textContent = lang.shippingAtCheckout;
		panel.querySelector( '[data-kaizen-checkout]' ).textContent = lang.checkout;
		panel.querySelector( '.kaizen-cart-continue' ).textContent = lang.continueShopping;
		panel.querySelector( '.kaizen-cart-close' ).setAttribute( 'aria-label', lang.close );
		panel.querySelector( '.kaizen-cart-empty' ).textContent = lang.emptyCart;
		var list = panel.querySelector( '.kaizen-cart-lines' );
		// The lines are drawn again on every change: the control that had focus gets it back, so the keyboard keeps its place.
		var active = document.activeElement && panel.contains( document.activeElement ) ? document.activeElement.getAttribute( 'data-focus' ) : null;
		list.innerHTML = '';
		var blocked = false;
		state.lines.forEach( function ( line, i ) {
			var info = quote && quote.lines && quote.lines[ i ] && quote.lines[ i ].variant_id === line.v ? quote.lines[ i ] : null;
			if ( info && info.status === 'unavailable' ) {
				blocked = true;
			}
			list.appendChild( lineNode( line, info ) );
		} );
		var has = state.lines.length > 0;
		panel.querySelector( '.kaizen-cart-empty' ).hidden = has;
		panel.querySelector( '.kaizen-cart-footer' ).querySelector( '.kaizen-cart-subtotal' ).hidden = ! has;
		panel.querySelector( '.kaizen-cart-note' ).hidden = ! has;
		var checkoutButton = panel.querySelector( '[data-kaizen-checkout]' );
		checkoutButton.hidden = ! has;
		checkoutButton.disabled = ! has || blocked || busy || ! quote;
		var subtotal = panel.querySelector( '[data-subtotal]' );
		subtotal.textContent = quote && has ? quote.subtotal_text + ( quote.vat_label ? ' ' + quote.vat_label : '' ) : '';
		if ( ! panel.hidden && ! panel.contains( document.activeElement ) ) {
			var again = active ? panel.querySelector( '[data-focus="' + active.replace( /"/g, '' ) + '"]' ) : null;
			if ( again && ! again.disabled ) {
				again.focus();
			} else {
				( panel.querySelector( '.kaizen-cart-close' ) || panel ).focus();
			}
		}
	}

	// ---- the round button ------------------------------------------------------------------------------------------------

	var button = null;

	function renderButton() {
		var n = count();
		var lang = labels();
		var openers = document.querySelectorAll( '[data-kaizen-count]' );
		Array.prototype.forEach.call( openers, function ( node ) { node.textContent = n ? String( n ) : ''; node.hidden = ! n; } );
		if ( ! cfg.floating ) {
			return;
		}
		if ( ! n ) {
			if ( button ) {
				button.hidden = true;
			}
			return;
		}
		if ( ! button ) {
			button = el( 'button', { type: 'button', 'class': 'kaizen-cart-button', 'data-kaizen-open-cart': '' }, [
				el( 'svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', width: '24', height: '24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' } ),
				el( 'span', { 'class': 'kaizen-cart-count', 'data-kaizen-count': '' } )
			] );
			button.querySelector( 'svg' ).innerHTML = '<path d="M6 6h15l-1.5 9h-12z" stroke-linejoin="round"/><path d="M6 6L5 3H2" stroke-linecap="round"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/>';
			document.body.appendChild( button );
		}
		button.hidden = false;
		button.setAttribute( 'aria-label', lang.cart + ' (' + n + ')' );
		button.querySelector( '.kaizen-cart-count' ).textContent = String( n );
	}

	// ---- opening and closing -------------------------------------------------------------------------------------------

	function openCart( from ) {
		build();
		opener = from && from.focus ? from : null;
		render();
		panel.hidden = false;
		document.body.classList.add( 'kaizen-cart-open' );
		window.requestAnimationFrame( function () {
			panel.classList.add( 'is-open' );
			var close = panel.querySelector( '.kaizen-cart-close' );
			if ( close ) {
				close.focus();
			}
		} );
		if ( state.lines.length ) {
			schedule();
		}
	}

	function closeCart() {
		if ( ! panel || panel.hidden ) {
			return;
		}
		panel.classList.remove( 'is-open' );
		document.body.classList.remove( 'kaizen-cart-open' );
		var done = function () {
			panel.hidden = true;
			if ( opener && document.contains( opener ) ) {
				opener.focus();
			}
		};
		if ( window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) {
			done();
		} else {
			setTimeout( done, 260 );
		}
	}

	function trap( event ) {
		if ( event.key !== 'Tab' ) {
			return;
		}
		var focusable = Array.prototype.slice.call( panel.querySelectorAll( 'a[href], button:not([disabled]):not([hidden]), input, [tabindex]:not([tabindex="-1"])' ) ).filter( function ( node ) { return node.offsetParent !== null; } );
		if ( ! focusable.length ) {
			return;
		}
		var first = focusable[ 0 ];
		var last = focusable[ focusable.length - 1 ];
		if ( event.shiftKey && document.activeElement === first ) {
			event.preventDefault();
			last.focus();
		} else if ( ! event.shiftKey && document.activeElement === last ) {
			event.preventDefault();
			first.focus();
		}
	}

	// ---- the hand-over to the store's checkout ---------------------------------------------------------------------------

	function checkout() {
		if ( busy || ! state.lines.length ) {
			return;
		}
		busy = true;
		render();
		status( text.checking || '' );
		var request = body();
		request.to = 'checkout';
		post( 'checkout', request ).then( function ( answer ) {
			if ( answer.status === 200 && answer.json.url ) {
				// The cart now lives in the store: it is not kept here a second time.
				state = empty();
				quote = null;
				save();
				window.location.assign( answer.json.url );
				return;
			}
			busy = false;
			render();
			status( answer.status === 422 ? labels().noLongerAvailable : ( answer.json && answer.json.error && answer.json.error.message ) || labels().tryAgain );
			if ( answer.status === 422 ) {
				refresh();
			}
		} ).catch( function () {
			busy = false;
			render();
			status( labels().tryAgain );
		} );
	}

	// ---- the product page ----------------------------------------------------------------------------------------------

	function initProduct( root ) {
		var holder = root.querySelector( '[data-kaizen-data]' );
		if ( ! holder || root.getAttribute( 'data-kaizen-ready' ) ) {
			return;
		}
		root.setAttribute( 'data-kaizen-ready', '1' );
		var data = JSON.parse( holder.textContent );
		var lang = Object.assign( {}, DEFAULT_LABELS, data.labels || {} );
		var chosen = {};
		var variants = data.variants;
		var groups = Array.prototype.slice.call( root.querySelectorAll( '.kaizen-option' ) );
		var priceBox = root.querySelector( '[data-kaizen-price]' );
		var stockBox = root.querySelector( '[data-kaizen-stock]' );
		var buy = root.querySelector( '[data-kaizen-buy]' );
		var qty = root.querySelector( '[data-kaizen-qty]' );
		var main = root.querySelector( '[data-kaizen-main]' );

		function matches( variant, wanted ) {
			return Object.keys( wanted ).every( function ( name ) { return variant.options[ name ] === wanted[ name ]; } );
		}

		function current() {
			var found = variants.filter( function ( variant ) { return matches( variant, chosen ); } );
			return found[ 0 ] || variants[ 0 ];
		}

		function show( variant ) {
			priceBox.innerHTML = '';
			priceBox.appendChild( priceNodes( variant.price ) );
			var stock = variant.stock;
			if ( stockBox ) {
				stockBox.textContent = stock.level === 'out' ? lang.outOfStock : ( stock.level === 'low' ? lang.lowStock.replace( '{n}', String( stock.low ) ) : lang.inStock );
				stockBox.className = 'kaizen-stock kaizen-stock--' + stock.level;
			}
			if ( buy ) {
				buy.disabled = stock.level === 'out';
				buy.textContent = stock.level === 'out' ? lang.soldOut || lang.outOfStock : lang.addToCart;
			}
			if ( qty ) {
				qty.max = String( Math.max( 1, stock.max ) );
				if ( Number( qty.value ) > stock.max && stock.max > 0 ) {
					qty.value = String( stock.max );
				}
			}
			if ( main && variant.image && variant.image.url ) {
				main.src = variant.image.url;
				main.alt = variant.image.alt || '';
			}
			groups.forEach( function ( group ) {
				var name = group.getAttribute( 'data-option' );
				Array.prototype.forEach.call( group.querySelectorAll( 'input' ), function ( input ) {
					var test = Object.assign( {}, chosen );
					test[ name ] = input.value;
					input.disabled = ! variants.some( function ( v ) { return matches( v, test ); } );
					input.checked = chosen[ name ] === input.value;
				} );
			} );
		}

		var first = variants[ 0 ];
		Object.keys( first.options ).forEach( function ( name ) { chosen[ name ] = first.options[ name ]; } );
		groups.forEach( function ( group ) {
			group.addEventListener( 'change', function ( event ) {
				chosen[ group.getAttribute( 'data-option' ) ] = event.target.value;
				// A choice with no variant behind it falls back to one that exists.
				if ( ! variants.some( function ( v ) { return matches( v, chosen ); } ) ) {
					var fallback = variants.filter( function ( v ) { return v.options[ group.getAttribute( 'data-option' ) ] === event.target.value; } )[ 0 ];
					if ( fallback ) {
						chosen = Object.assign( {}, fallback.options );
					}
				}
				show( current() );
			} );
		} );
		Array.prototype.forEach.call( root.querySelectorAll( '[data-kaizen-thumb]' ), function ( thumb ) {
			thumb.addEventListener( 'click', function () {
				if ( main ) {
					main.src = thumb.getAttribute( 'data-kaizen-thumb' );
					main.alt = thumb.getAttribute( 'data-alt' ) || '';
				}
			} );
		} );
		if ( buy ) {
			buy.addEventListener( 'click', function () {
				var variant = current();
				var image = ( variant.image && variant.image.url ) || ( data.images[ 0 ] && data.images[ 0 ].url ) || '';
				var options = Object.keys( variant.options ).map( function ( key ) { return variant.options[ key ]; } ).join( ' / ' );
				add( { store: data.store, market: data.market, variant: variant.id, title: data.title + ( options ? ' – ' + options : '' ), image: image, price: variant.price.text, url: window.location.href }, Math.max( 1, Math.min( MAX_QTY, parseInt( qty ? qty.value : '1', 10 ) || 1 ) ), data.labels );
			} );
		}
		show( current() );
	}

	// ---- wiring --------------------------------------------------------------------------------------------------------

	document.addEventListener( 'click', function ( event ) {
		var addButton = event.target.closest( '[data-kaizen-add]' );
		if ( addButton ) {
			event.preventDefault();
			try {
				var item = JSON.parse( addButton.getAttribute( 'data-kaizen-add' ) );
				add( item, 1, null );
			} catch ( e ) { /* a card the script cannot read does nothing */ }
			return;
		}
		var opens = event.target.closest( '[data-kaizen-open-cart], .kaizen-open-cart' );
		if ( opens ) {
			event.preventDefault();
			openCart( opens );
		}
	} );

	document.addEventListener( 'keydown', function ( event ) {
		if ( event.key === 'Escape' && panel && ! panel.hidden ) {
			closeCart();
		}
	} );

	window.addEventListener( 'storage', function ( event ) {
		if ( event.key === KEY ) {
			state = load();
			quote = null;
			render();
			if ( panel && ! panel.hidden ) {
				schedule();
			}
		}
	} );

	// Back from the store with the browser's button: the cart is as it is now.
	window.addEventListener( 'pageshow', function ( event ) {
		if ( event.persisted ) {
			state = load();
			quote = null;
			busy = false;
			render();
		}
	} );

	function start() {
		render();
		var products = document.querySelectorAll( '[data-kaizen-product]' );
		for ( var i = 0; i < products.length; i++ ) {
			initProduct( products[ i ] );
		}
	}

	window.KaizenStoreShop = { open: function () { openCart( document.activeElement ); }, init: start };
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', start );
	} else {
		start();
	}
} )();
