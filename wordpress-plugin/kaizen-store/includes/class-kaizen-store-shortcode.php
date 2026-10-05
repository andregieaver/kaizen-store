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
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'register_assets' ) );
	}

	public static function register_assets() {
		wp_register_style( 'kaizen-store', KAIZEN_STORE_URL . 'assets/frontend.css', array(), KAIZEN_STORE_VERSION );
		wp_register_script( 'kaizen-store', KAIZEN_STORE_URL . 'assets/frontend.js', array(), KAIZEN_STORE_VERSION, true );
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
		wp_enqueue_style( 'kaizen-store' );
		if ( 'carousel' === $config['layout'] ) {
			wp_enqueue_script( 'kaizen-store' );
		}
		return Kaizen_Store_Render::render( $config );
	}
}
