<?php
/**
 * Draws a view's products as a grid or a carousel. The products, their prices (with VAT as the store shows them, a reduction only when
 * it is a genuine one, the price per kilo or litre) and their words come from Kaizen ready written in the market's language: the plugin
 * never works out or rewrites a price.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Render {

	const CACHE_PREFIX = 'kaizen_store_v_';
	const STALE_PREFIX = 'kaizen_store_s_';

	/**
	 * Seconds a view's products are kept before Kaizen is asked again.
	 *
	 * @return int
	 */
	public static function cache_seconds() {
		return max( 0, (int) apply_filters( 'kaizen_store_cache_seconds', 10 * MINUTE_IN_SECONDS ) );
	}

	/**
	 * The products of a view: from the cache while fresh, else from Kaizen; if Kaizen cannot answer, the last good answer (kept for a week).
	 *
	 * @param array $config A view's settings.
	 * @param bool  $fresh  Skip the cache (the editor's preview).
	 * @return array|WP_Error
	 */
	public static function fetch( $config, $fresh = false ) {
		if ( '' === $config['store'] ) {
			return new WP_Error( 'kaizen_no_store', __( 'This view has no store chosen.', 'kaizen-store' ) );
		}
		$query = Kaizen_Store_Views::query( $config );
		$key   = md5( wp_json_encode( array( $config['store'], $query ) ) );
		if ( ! $fresh ) {
			$cached = get_transient( self::CACHE_PREFIX . $key );
			if ( is_array( $cached ) ) {
				return $cached;
			}
		}
		$view = Kaizen_Store_Api::view( $config['store'], $query );
		if ( is_wp_error( $view ) ) {
			// The last good list is only a stand-in while Kaizen cannot answer: a refusal (a disconnected site, a store that is no longer yours) shows nothing.
			$outage = in_array( $view->get_error_code(), array( 'kaizen_unreachable', 'kaizen_error', 'kaizen_unavailable', 'kaizen_rate_limited' ), true );
			$stale  = $fresh || ! $outage ? false : get_transient( self::STALE_PREFIX . $key );
			if ( ! $outage ) {
				delete_transient( self::CACHE_PREFIX . $key );
				delete_transient( self::STALE_PREFIX . $key );
			}
			return is_array( $stale ) ? $stale : $view;
		}
		if ( self::cache_seconds() > 0 ) {
			set_transient( self::CACHE_PREFIX . $key, $view, self::cache_seconds() );
		}
		set_transient( self::STALE_PREFIX . $key, $view, WEEK_IN_SECONDS );
		return $view;
	}

	/**
	 * Forgets every kept answer (after a view is saved, or when the owner asks).
	 */
	public static function clear_cache() {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$names = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s",
				$wpdb->esc_like( '_transient_' . self::CACHE_PREFIX ) . '%',
				$wpdb->esc_like( '_transient_timeout_' . self::CACHE_PREFIX ) . '%',
				$wpdb->esc_like( '_transient_' . self::STALE_PREFIX ) . '%',
				$wpdb->esc_like( '_transient_timeout_' . self::STALE_PREFIX ) . '%'
			)
		);
		foreach ( (array) $names as $name ) {
			if ( 0 === strpos( $name, '_transient_timeout_' ) ) {
				continue;
			}
			delete_transient( substr( $name, strlen( '_transient_' ) ) );
		}
	}

	/**
	 * The default words of the button, in the market's language.
	 *
	 * @param string $language Language code, for example "nb".
	 * @return string
	 */
	public static function button_text( $language ) {
		$words = array(
			'nb' => 'Se produkt',
			'nn' => 'Sjå produkt',
			'no' => 'Se produkt',
			'da' => 'Se produkt',
			'sv' => 'Visa produkt',
			'de' => 'Produkt ansehen',
			'fi' => 'Katso tuote',
		);
		$code  = strtolower( substr( (string) $language, 0, 2 ) );
		return isset( $words[ $code ] ) ? $words[ $code ] : __( 'View product', 'kaizen-store' );
	}

	/**
	 * The price of a product as Kaizen wrote it.
	 *
	 * @param array $price Price from the view.
	 * @return string
	 */
	public static function price_html( $price ) {
		if ( ! is_array( $price ) || empty( $price['text'] ) ) {
			return '';
		}
		$html  = '<span class="kaizen-price-now">';
		$html .= ! empty( $price['from_label'] ) ? '<span class="kaizen-from">' . esc_html( $price['from_label'] ) . '</span> ' : '';
		$html .= '<span class="kaizen-amount">' . esc_html( $price['text'] ) . '</span>';
		$html .= ! empty( $price['vat_label'] ) ? ' <span class="kaizen-vat">' . esc_html( $price['vat_label'] ) . '</span>' : '';
		$html .= '</span>';
		if ( ! empty( $price['prior_text'] ) && ! empty( $price['prior_label'] ) ) {
			$html .= '<span class="kaizen-price-prior">' . esc_html( $price['prior_label'] ) . ': <span>' . esc_html( $price['prior_text'] ) . '</span></span>';
		}
		if ( ! empty( $price['unit_text'] ) ) {
			$html .= '<span class="kaizen-unit">' . esc_html( $price['unit_text'] ) . '</span>';
		}
		return $html;
	}

	/**
	 * One product's card.
	 *
	 * @param array $product Product from the view.
	 * @param array $config  A view's settings.
	 * @param array $view    The view's answer (for the market's language).
	 * @return string
	 */
	public static function item_html( $product, $config, $view ) {
		$url    = isset( $product['url'] ) ? $product['url'] : '';
		$title  = isset( $product['title'] ) ? $product['title'] : '';
		$target = $config['new_tab'] ? ' target="_blank" rel="noopener"' : '';
		$html   = '<li class="kaizen-item"><div class="kaizen-card">';
		$html  .= '<a class="kaizen-link" href="' . esc_url( $url ) . '"' . $target . '>';
		if ( ! empty( $product['image']['url'] ) ) {
			$html .= '<span class="kaizen-image"><img src="' . esc_url( $product['image']['url'] ) . '" alt="' . esc_attr( isset( $product['image']['alt'] ) ? $product['image']['alt'] : '' ) . '" loading="lazy" decoding="async"></span>';
		} else {
			$html .= '<span class="kaizen-image kaizen-image--none" aria-hidden="true"></span>';
		}
		$html .= '<span class="kaizen-title">' . esc_html( $title ) . '</span></a>';
		if ( $config['show_price'] ) {
			$price = self::price_html( isset( $product['price'] ) ? $product['price'] : null );
			$html .= '' !== $price ? '<p class="kaizen-price">' . $price . '</p>' : '';
		}
		if ( $config['show_excerpt'] && ! empty( $product['excerpt'] ) ) {
			$html .= '<p class="kaizen-excerpt">' . esc_html( $product['excerpt'] ) . '</p>';
		}
		if ( $config['show_button'] ) {
			$language = isset( $view['market']['language'] ) ? $view['market']['language'] : '';
			$text     = '' !== $config['button_text'] ? $config['button_text'] : self::button_text( $language );
			$html    .= '<p class="kaizen-action"><a class="kaizen-button" href="' . esc_url( $url ) . '"' . $target . ' aria-label="' . esc_attr( $text . ': ' . $title ) . '">' . esc_html( $text ) . '</a></p>';
		}
		return $html . '</div></li>';
	}

	/**
	 * A view's HTML. Only what Kaizen answered, escaped; nothing from the visitor.
	 *
	 * @param array $view   Answer of the view call.
	 * @param array $config A view's settings.
	 * @return string
	 */
	public static function html( $view, $config ) {
		$products = isset( $view['products'] ) && is_array( $view['products'] ) ? $view['products'] : array();
		if ( empty( $products ) ) {
			return '';
		}
		$carousel = 'carousel' === $config['layout'];
		$columns  = (int) $config['columns'];
		$label    = isset( $view['store']['name'] ) ? $view['store']['name'] : '';
		$class    = 'kaizen-view kaizen-view--' . ( $carousel ? 'carousel' : 'grid' ) . ' kaizen-cols-' . $columns;
		$html     = '<div class="' . esc_attr( $class ) . '" style="--kz-cols:' . $columns . '"';
		if ( $carousel ) {
			/* translators: %s: the name of the store. */
			$html .= ' role="region" aria-roledescription="carousel" aria-label="' . esc_attr( sprintf( __( 'Products from %s', 'kaizen-store' ), $label ) ) . '" data-kaizen-carousel';
		}
		$html .= '>';
		if ( $carousel ) {
			$html .= '<button type="button" class="kaizen-nav kaizen-prev" aria-label="' . esc_attr__( 'Previous products', 'kaizen-store' ) . '" hidden><span aria-hidden="true">&#8249;</span></button>';
		}
		$html .= '<ul class="kaizen-items" role="list"' . ( $carousel ? ' tabindex="0"' : '' ) . '>';
		foreach ( $products as $product ) {
			$html .= self::item_html( $product, $config, $view );
		}
		$html .= '</ul>';
		if ( $carousel ) {
			$html .= '<button type="button" class="kaizen-nav kaizen-next" aria-label="' . esc_attr__( 'Next products', 'kaizen-store' ) . '" hidden><span aria-hidden="true">&#8250;</span></button>';
		}
		return $html . '</div>';
	}

	/**
	 * The whole answer to a shortcode: the view's HTML, or a note for the people who can fix it (never shown to visitors).
	 *
	 * @param array $config A view's settings.
	 * @param bool  $fresh  Skip the cache.
	 * @return string
	 */
	public static function render( $config, $fresh = false ) {
		$view = self::fetch( $config, $fresh );
		if ( is_wp_error( $view ) ) {
			return self::note( $view->get_error_message() );
		}
		$html = self::html( $view, $config );
		if ( '' === $html ) {
			if ( isset( $view['open'] ) && false === $view['open'] ) {
				return self::note( __( 'This store is not open yet, so it has no products to show.', 'kaizen-store' ) );
			}
			return self::note( __( 'No products match this view.', 'kaizen-store' ) );
		}
		return $html;
	}

	/**
	 * A message only an administrator sees, in place of products.
	 *
	 * @param string $message Message.
	 * @return string
	 */
	public static function note( $message ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return '';
		}
		return '<p class="kaizen-note"><strong>Kaizen Store:</strong> ' . esc_html( $message ) . ' <em>' . esc_html__( '(Only administrators see this message.)', 'kaizen-store' ) . '</em></p>';
	}
}
