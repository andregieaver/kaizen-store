<?php
/**
 * The product page: one WordPress page holding [kaizen_product] shows any product of a connected store, chosen by the address
 * (/product/{store}/{market}/{handle}/, or ?kz_store=&kz_market=&kz_handle= without pretty permalinks). It is drawn on the server, from what
 * Kaizen answers, so it can be read by search engines; the choice of a variant, the picture and the cart are the script's.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Product {

	const OPTION_PAGE = 'kaizen_store_product_page';
	const OPTION_FLUSH = 'kaizen_store_flush_rules';

	/**
	 * The product asked for in this request: array( 'store', 'market', 'handle', 'data' ) with 'data' an answer or a WP_Error.
	 *
	 * @var array|null
	 */
	private static $current = null;

	public static function init() {
		add_action( 'init', array( __CLASS__, 'rules' ) );
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'prepare' ), 1 );
		add_filter( 'pre_get_document_title', array( __CLASS__, 'document_title' ), 20 );
		add_filter( 'the_title', array( __CLASS__, 'page_title' ), 10, 2 );
		add_action( 'wp_head', array( __CLASS__, 'head' ), 1 );
		add_shortcode( 'kaizen_product', array( __CLASS__, 'render' ) );
		add_action( 'update_option_' . self::OPTION_PAGE, array( __CLASS__, 'schedule_flush' ) );
		add_action( 'add_option_' . self::OPTION_PAGE, array( __CLASS__, 'schedule_flush' ) );
	}

	public static function schedule_flush() {
		update_option( self::OPTION_FLUSH, '1', false );
	}

	public static function page_id() {
		$id = (int) get_option( self::OPTION_PAGE, 0 );
		return $id && 'page' === get_post_type( $id ) && 'publish' === get_post_status( $id ) ? $id : 0;
	}

	/**
	 * Makes the product page (on activation, or when asked): a page whose content is the shortcode.
	 *
	 * @return int The page's id, or 0.
	 */
	public static function create_page() {
		$existing = self::page_id();
		if ( $existing ) {
			return $existing;
		}
		$id = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => 'publish',
				'post_title'   => __( 'Product', 'kaizen-store' ),
				'post_name'    => 'kaizen-product',
				'post_content' => '[kaizen_product]',
			)
		);
		if ( $id && ! is_wp_error( $id ) ) {
			update_option( self::OPTION_PAGE, (int) $id, false );
			self::schedule_flush();
			return (int) $id;
		}
		return 0;
	}

	public static function query_vars( $vars ) {
		return array_merge( $vars, array( 'kz_store', 'kz_market', 'kz_handle' ) );
	}

	/**
	 * The pretty address of the product page: /{page}/{store}/{market}/{handle}/.
	 */
	public static function rules() {
		$page = self::page_id();
		if ( ! $page ) {
			return;
		}
		$uri = get_page_uri( $page );
		if ( $uri ) {
			add_rewrite_rule(
				'^' . preg_quote( $uri, '#' ) . '/([a-z0-9-]{3,40})/([a-z0-9-]{2,40})/([a-z0-9][a-z0-9-]{0,98})/?$',
				'index.php?page_id=' . $page . '&kz_store=$matches[1]&kz_market=$matches[2]&kz_handle=$matches[3]',
				'top'
			);
		}
		if ( '1' === get_option( self::OPTION_FLUSH ) ) {
			delete_option( self::OPTION_FLUSH );
			flush_rewrite_rules( false );
		}
	}

	/**
	 * The address of a product on this site, or the store's own address when there is no product page.
	 *
	 * @param string $store     Store slug.
	 * @param string $market    Market slug.
	 * @param string $handle    Product handle.
	 * @param string $store_url The product's address on the store.
	 * @return string
	 */
	public static function url( $store, $market, $handle, $store_url ) {
		$page = Kaizen_Store_Settings::shop_enabled() ? self::page_id() : 0;
		if ( ! $page ) {
			return $store_url;
		}
		if ( get_option( 'permalink_structure' ) ) {
			return trailingslashit( get_permalink( $page ) ) . rawurlencode( $store ) . '/' . rawurlencode( $market ) . '/' . rawurlencode( $handle ) . '/';
		}
		return add_query_arg(
			array(
				'page_id'   => $page,
				'kz_store'  => $store,
				'kz_market' => $market,
				'kz_handle' => $handle,
			),
			home_url( '/' )
		);
	}

	private static function clean( $value, $max = 100 ) {
		$value = is_string( $value ) ? strtolower( $value ) : '';
		return preg_match( '/^[a-z0-9][a-z0-9-]{0,' . ( $max - 1 ) . '}$/', $value ) ? $value : '';
	}

	/**
	 * Reads the product asked for (once per request) from the cache or from Kaizen.
	 *
	 * @param string $store  Store slug.
	 * @param string $market Market slug (may be empty).
	 * @param string $handle Product handle.
	 * @return array|WP_Error
	 */
	public static function fetch( $store, $market, $handle ) {
		if ( ! in_array( $store, Kaizen_Store_Views::stores_in_use(), true ) ) {
			return new WP_Error( 'kaizen_no_such_product', __( 'No such product.', 'kaizen-store' ), array( 'status' => 404 ) );
		}
		$key    = 'kaizen_store_p_' . md5( $store . '|' . $market . '|' . $handle );
		$cached = get_transient( $key );
		if ( is_array( $cached ) ) {
			return $cached;
		}
		$answer = Kaizen_Store_Api::product( $store, $market, $handle );
		if ( is_wp_error( $answer ) ) {
			return $answer;
		}
		$seconds = max( 0, (int) apply_filters( 'kaizen_store_product_cache_seconds', 2 * MINUTE_IN_SECONDS ) );
		if ( $seconds > 0 ) {
			set_transient( $key, $answer, $seconds );
		}
		return $answer;
	}

	/**
	 * On the product page: finds the product before anything is printed, so the title, description and structured data are in the head and
	 * an unknown product is a real 404.
	 */
	public static function prepare() {
		$page = self::page_id();
		if ( ! $page || ! is_page( $page ) ) {
			return;
		}
		$store  = self::clean( get_query_var( 'kz_store' ), 40 );
		$market = self::clean( get_query_var( 'kz_market' ), 40 );
		$handle = self::clean( get_query_var( 'kz_handle' ), 100 );
		if ( '' === $store || '' === $handle ) {
			return;
		}
		$data = self::fetch( $store, $market, $handle );
		self::$current = array(
			'store'  => $store,
			'market' => $market,
			'handle' => $handle,
			'data'   => $data,
		);
		// The address is the product's: WordPress must not "correct" it to the page's, nor guess another for an unknown product.
		add_filter( 'redirect_canonical', '__return_false' );
		if ( is_wp_error( $data ) ) {
			$status = $data->get_error_data();
			if ( is_array( $status ) && isset( $status['status'] ) && 404 === (int) $status['status'] ) {
				global $wp_query;
				$wp_query->set_404();
				status_header( 404 );
				nocache_headers();
			}
			return;
		}
		// The page's own canonical address would make every product one page: this request prints its own.
		remove_action( 'wp_head', 'rel_canonical' );
	}

	private static function product() {
		return self::$current && is_array( self::$current['data'] ) && isset( self::$current['data']['product'] ) ? self::$current['data']['product'] : null;
	}

	public static function document_title( $title ) {
		$product = self::product();
		if ( ! $product ) {
			return $title;
		}
		$name = '' !== $product['seo_title'] ? $product['seo_title'] : $product['title'];
		return $name . ' – ' . get_bloginfo( 'name' );
	}

	/**
	 * The page's title in the theme is the product's.
	 */
	public static function page_title( $title, $post_id = 0 ) {
		$product = self::product();
		if ( $product && (int) $post_id === self::page_id() && in_the_loop() && is_main_query() ) {
			return $product['title'];
		}
		return $title;
	}

	private static function description( $product ) {
		$text = '' !== $product['seo_description'] ? $product['seo_description'] : $product['description'];
		return wp_trim_words( wp_strip_all_tags( $text ), 40, '…' );
	}

	public static function head() {
		$product = self::product();
		if ( ! $product ) {
			return;
		}
		$url         = self::url( self::$current['store'], self::$current['data']['market']['slug'], $product['handle'], $product['url'] );
		$description = self::description( $product );
		$image       = ! empty( $product['images'][0]['url'] ) ? $product['images'][0]['url'] : '';
		echo '<link rel="canonical" href="' . esc_url( $url ) . '">' . "\n";
		if ( '' !== $description ) {
			echo '<meta name="description" content="' . esc_attr( $description ) . '">' . "\n";
		}
		echo '<meta property="og:type" content="product">' . "\n";
		echo '<meta property="og:title" content="' . esc_attr( $product['title'] ) . '">' . "\n";
		echo '<meta property="og:url" content="' . esc_url( $url ) . '">' . "\n";
		if ( '' !== $description ) {
			echo '<meta property="og:description" content="' . esc_attr( $description ) . '">' . "\n";
		}
		if ( '' !== $image ) {
			echo '<meta property="og:image" content="' . esc_url( $image ) . '">' . "\n";
		}
		echo '<script type="application/ld+json">' . wp_json_encode( self::json_ld( $product, $url, $description ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP ) . '</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON with its tags and ampersands encoded.
	}

	/**
	 * Structured data for search engines: the product, and its price (with VAT as the store shows it) and whether it is in stock.
	 */
	public static function json_ld( $product, $url, $description ) {
		$prices = array();
		$stock  = false;
		foreach ( $product['variants'] as $variant ) {
			$prices[] = $variant['price']['amount_decimal'];
			$stock    = $stock || 'out' !== $variant['stock']['level'];
		}
		sort( $prices, SORT_NUMERIC );
		$currency = ! empty( $product['variants'][0]['price']['currency'] ) ? $product['variants'][0]['price']['currency'] : '';
		$offer    = array(
			'@type'         => count( array_unique( $prices ) ) > 1 ? 'AggregateOffer' : 'Offer',
			'priceCurrency' => $currency,
			'availability'  => $stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
			'url'           => $url,
		);
		if ( 'AggregateOffer' === $offer['@type'] ) {
			$offer['lowPrice']   = $prices[0];
			$offer['highPrice']  = $prices[ count( $prices ) - 1 ];
			$offer['offerCount'] = count( $product['variants'] );
		} elseif ( ! empty( $prices ) ) {
			$offer['price'] = $prices[0];
		}
		$data = array(
			'@context'    => 'https://schema.org',
			'@type'       => 'Product',
			'name'        => $product['title'],
			'description' => $description,
			'url'         => $url,
			'offers'      => $offer,
		);
		$images = wp_list_pluck( $product['images'], 'url' );
		if ( ! empty( $images ) ) {
			$data['image'] = array_values( $images );
		}
		if ( 1 === count( $product['variants'] ) && '' !== $product['variants'][0]['sku'] ) {
			$data['sku'] = $product['variants'][0]['sku'];
		}
		return $data;
	}

	/**
	 * The shortcode: the product of the address, or one named in the shortcode ([kaizen_product store="…" handle="…"]).
	 *
	 * @param array|string $atts Attributes.
	 * @return string
	 */
	public static function render( $atts ) {
		$atts = shortcode_atts(
			array(
				'store'  => '',
				'market' => '',
				'handle' => '',
				'title'  => '',
			),
			is_array( $atts ) ? $atts : array(),
			'kaizen_product'
		);
		$current = self::$current;
		if ( ! $current || ( '' !== $atts['handle'] && self::clean( $atts['handle'] ) !== $current['handle'] ) ) {
			$store  = self::clean( $atts['store'], 40 );
			$handle = self::clean( $atts['handle'] );
			if ( '' === $store || '' === $handle ) {
				return Kaizen_Store_Render::note( __( 'This page shows a product when it is opened from a product list. Add a view with products to your site first.', 'kaizen-store' ) );
			}
			$current = array(
				'store'  => $store,
				'market' => self::clean( $atts['market'], 40 ),
				'handle' => $handle,
				'data'   => self::fetch( $store, self::clean( $atts['market'], 40 ), $handle ),
			);
		}
		if ( is_wp_error( $current['data'] ) ) {
			return Kaizen_Store_Render::note( $current['data']->get_error_message() );
		}
		Kaizen_Store_Shortcode::enqueue_shop();
		return self::html( $current['data'], 'show' === $atts['title'] );
	}

	/**
	 * One option as a group of choices.
	 */
	private static function option_html( $option, $index ) {
		$html = '<fieldset class="kaizen-option" data-option="' . esc_attr( $option['name'] ) . '"><legend>' . esc_html( $option['name'] ) . '</legend><div class="kaizen-choices">';
		foreach ( $option['values'] as $value ) {
			$id    = 'kaizen-opt-' . $index . '-' . md5( $value );
			$html .= '<span class="kaizen-choice"><input type="radio" name="kaizen-opt-' . (int) $index . '" id="' . esc_attr( $id ) . '" value="' . esc_attr( $value ) . '"><label for="' . esc_attr( $id ) . '">' . esc_html( $value ) . '</label></span>';
		}
		return $html . '</div></fieldset>';
	}

	/**
	 * The product's markup. The script takes over the choice of variant from the data in the script tag; without it the first variant is shown.
	 *
	 * @param array $answer     The product call's answer.
	 * @param bool  $with_title Whether to print the product's name here (the theme usually prints the page's title, which is the product's).
	 * @return string
	 */
	public static function html( $answer, $with_title = false ) {
		$product  = $answer['product'];
		$labels   = $answer['labels'];
		$first    = $product['variants'][0];
		$images   = $product['images'];
		$data     = array(
			'store'    => $answer['store']['slug'],
			'market'   => $answer['market']['slug'],
			'handle'   => $product['handle'],
			'title'    => $product['title'],
			'url'      => $product['url'],
			'cartable' => (bool) $product['cartable'],
			'options'  => $product['options'],
			'variants' => $product['variants'],
			'images'   => $images,
			'labels'   => $labels,
		);
		$html  = '<div class="kaizen-product" data-kaizen-product>';
		$html .= '<div class="kaizen-product-gallery">';
		$main  = ! empty( $first['image']['url'] ) ? $first['image'] : ( ! empty( $images[0] ) ? $images[0] : null );
		$html .= '<div class="kaizen-product-main">' . ( $main ? '<img src="' . esc_url( $main['url'] ) . '" alt="' . esc_attr( $main['alt'] ) . '" data-kaizen-main>' : '' ) . '</div>';
		if ( count( $images ) > 1 ) {
			$html .= '<ul class="kaizen-product-thumbs" role="list">';
			foreach ( $images as $image ) {
				$html .= '<li><button type="button" data-kaizen-thumb="' . esc_url( $image['url'] ) . '" data-alt="' . esc_attr( $image['alt'] ) . '"><img src="' . esc_url( $image['thumbnail'] ) . '" alt="' . esc_attr( $image['alt'] ) . '" loading="lazy"></button></li>';
			}
			$html .= '</ul>';
		}
		$html .= '</div><div class="kaizen-product-info">';
		if ( $with_title ) {
			$html .= '<h2 class="kaizen-product-title">' . esc_html( $product['title'] ) . '</h2>';
		}
		$html .= '<p class="kaizen-price" data-kaizen-price>' . Kaizen_Store_Render::price_html( $first['price'] ) . '</p>';
		foreach ( $product['options'] as $index => $option ) {
			if ( count( $product['variants'] ) > 1 ) {
				$html .= self::option_html( $option, $index );
			}
		}
		$html .= '<p class="kaizen-stock" data-kaizen-stock aria-live="polite"></p>';
		if ( $product['cartable'] ) {
			$html .= '<div class="kaizen-buy"><label class="kaizen-qty"><span>' . esc_html( $labels['quantity'] ) . '</span><input type="number" min="1" max="20" value="1" inputmode="numeric" data-kaizen-qty></label>';
			$html .= '<button type="button" class="kaizen-add kaizen-add--large" data-kaizen-buy>' . esc_html( $labels['addToCart'] ) . '</button></div>';
		} else {
			$html .= '<p><a class="kaizen-button" href="' . esc_url( $product['url'] ) . '">' . esc_html( $labels['viewInStore'] ) . '</a></p>';
		}
		if ( '' !== trim( $product['description'] ) ) {
			$html .= '<div class="kaizen-description">';
			foreach ( preg_split( '/\n{2,}/', trim( $product['description'] ) ) as $paragraph ) {
				$html .= '<p>' . nl2br( esc_html( trim( $paragraph ) ) ) . '</p>';
			}
			$html .= '</div>';
		}
		$html .= '</div>';
		$html .= '<script type="application/json" data-kaizen-data>' . wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP ) . '</script>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON with its tags and ampersands encoded.
		return $html . '</div>';
	}
}
