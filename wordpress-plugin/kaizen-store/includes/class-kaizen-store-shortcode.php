<?php
/**
 * The shortcode: [kaizen_products id="123"] shows a saved view. `layout`, `columns` and `limit` may be given to change that use of it.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Shortcode {

	public static function init() {
		add_shortcode( 'kaizen_products', array( __CLASS__, 'render' ) );
		add_shortcode( 'kaizen_cart_button', array( __CLASS__, 'cart_button' ) );
		// Registered at init, not at wp_enqueue_scripts: block themes draw a page's content (and so its shortcodes) before the head's scripts are queued.
		add_action( 'init', array( __CLASS__, 'register_assets' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_everywhere' ) );
	}

	public static function register_assets() {
		wp_register_style( 'kaizen-store', KAIZEN_STORE_URL . 'assets/frontend.css', array(), KAIZEN_STORE_VERSION );
		wp_register_script( 'kaizen-store', KAIZEN_STORE_URL . 'assets/frontend.js', array(), KAIZEN_STORE_VERSION, true );
		wp_register_script( 'kaizen-store-cart', KAIZEN_STORE_URL . 'assets/cart.js', array(), KAIZEN_STORE_VERSION, true );
	}

	/**
	 * The cart is on every page (its round button shows wherever something is in it) once the site is connected.
	 */
	public static function enqueue_everywhere() {
		if ( Kaizen_Store_Settings::is_connected() && Kaizen_Store_Settings::shop_enabled() && Kaizen_Store_Settings::floating_cart() ) {
			self::enqueue_shop();
		}
	}

	/**
	 * The cart's script and styles, with what the script needs to know.
	 */
	public static function enqueue_shop() {
		if ( ! Kaizen_Store_Settings::shop_enabled() ) {
			return;
		}
		wp_enqueue_style( 'kaizen-store' );
		if ( wp_script_is( 'kaizen-store-cart', 'enqueued' ) ) {
			return;
		}
		wp_enqueue_script( 'kaizen-store-cart' );
		wp_localize_script(
			'kaizen-store-cart',
			'KaizenStoreCart',
			array(
				'rest'     => esc_url_raw( rest_url( Kaizen_Store_Rest::NAMESPACE_ . '/cart/' ) ),
				'floating' => Kaizen_Store_Settings::floating_cart(),
				'text'     => array(
					'cart'     => __( 'Cart', 'kaizen-store' ),
					'close'    => __( 'Close', 'kaizen-store' ),
					'replace'  => __( 'Your cart has products from another store or market. Start a new cart with this product?', 'kaizen-store' ),
					'checking' => __( 'Taking you to the checkout …', 'kaizen-store' ),
					'error'    => __( 'Something went wrong. Try again.', 'kaizen-store' ),
					'loading'  => __( 'Updating the cart …', 'kaizen-store' ),
				),
			)
		);
	}

	/**
	 * [kaizen_cart_button label="Cart"]: a button for a menu or a header that opens the slide-out cart, with the number of units in it.
	 *
	 * @param array|string $atts Attributes.
	 * @return string
	 */
	public static function cart_button( $atts ) {
		$atts = shortcode_atts( array( 'label' => __( 'Cart', 'kaizen-store' ) ), is_array( $atts ) ? $atts : array(), 'kaizen_cart_button' );
		if ( ! Kaizen_Store_Settings::shop_enabled() ) {
			return '';
		}
		self::enqueue_shop();
		return '<button type="button" class="kaizen-open-cart" data-kaizen-open-cart>' . esc_html( $atts['label'] ) . ' <span class="kaizen-cart-count kaizen-cart-count--inline" data-kaizen-count hidden></span></button>';
	}

	/**
	 * The shortcode's HTML.
	 *
	 * @param array|string $atts Attributes.
	 * @return string
	 */
	public static function render( $atts ) {
		$atts = shortcode_atts(
			array(
				'id'      => 0,
				'layout'  => '',
				'columns' => '',
				'limit'   => '',
			),
			is_array( $atts ) ? $atts : array(),
			'kaizen_products'
		);
		$config = Kaizen_Store_Views::get( (int) $atts['id'] );
		if ( null === $config ) {
			return Kaizen_Store_Render::note( __( 'This shortcode points at a view that does not exist. Check its id under Kaizen, Views.', 'kaizen-store' ) );
		}
		if ( in_array( $atts['layout'], array( 'grid', 'carousel' ), true ) ) {
			$config['layout'] = $atts['layout'];
		}
		if ( is_numeric( $atts['columns'] ) ) {
			$config['columns'] = max( 1, min( 6, (int) $atts['columns'] ) );
		}
		if ( is_numeric( $atts['limit'] ) ) {
			$config['limit'] = max( 1, min( 48, (int) $atts['limit'] ) );
		}
		self::enqueue_shop();
		wp_enqueue_style( 'kaizen-store' );
		if ( 'carousel' === $config['layout'] ) {
			wp_enqueue_script( 'kaizen-store' );
		}
		return Kaizen_Store_Render::render( $config );
	}
}
