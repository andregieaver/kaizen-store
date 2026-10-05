/* Kaizen Store: previous and next buttons of a carousel. Without this the carousel still scrolls by touch, wheel and keyboard. */
( function () {
	'use strict';

	function setUp( root ) {
		if ( root.getAttribute( 'data-kaizen-ready' ) ) {
			return;
		}
		var track = root.querySelector( '.kaizen-items' );
		var prev = root.querySelector( '.kaizen-prev' );
		var next = root.querySelector( '.kaizen-next' );
		if ( ! track || ! prev || ! next ) {
			return;
		}
		root.setAttribute( 'data-kaizen-ready', '1' );

		function update() {
			var max = track.scrollWidth - track.clientWidth;
			var scrolls = max > 2;
			prev.hidden = ! scrolls;
			next.hidden = ! scrolls;
			prev.disabled = track.scrollLeft <= 2;
			next.disabled = track.scrollLeft >= max - 2;
		}

		function go( direction ) {
			track.scrollBy( { left: direction * track.clientWidth * 0.9, behavior: 'smooth' } );
		}

		prev.addEventListener( 'click', function () { go( -1 ); } );
		next.addEventListener( 'click', function () { go( 1 ); } );
		track.addEventListener( 'scroll', update, { passive: true } );
		window.addEventListener( 'resize', update );
		track.addEventListener( 'keydown', function ( event ) {
			if ( event.key === 'ArrowRight' ) {
				go( 1 );
			} else if ( event.key === 'ArrowLeft' ) {
				go( -1 );
			}
		} );
		var images = track.querySelectorAll( 'img' );
		for ( var i = 0; i < images.length; i++ ) {
			images[ i ].addEventListener( 'load', update );
		}
		update();
	}

	function all( scope ) {
		var roots = ( scope || document ).querySelectorAll( '[data-kaizen-carousel]' );
		for ( var i = 0; i < roots.length; i++ ) {
			setUp( roots[ i ] );
		}
	}

	window.KaizenStoreCarousels = all;
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', function () { all(); } );
	} else {
		all();
	}
} )();
