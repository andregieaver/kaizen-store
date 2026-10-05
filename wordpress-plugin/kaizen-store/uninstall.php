<?php
/**
 * Removes what the plugin keeps outside its views when it is deleted: the connection (Kaizen is told nothing: disconnect first to end
 * the token there), the address setting and the saved product lists. The saved views are the owner's content and are left in place.
 *
 * @package KaizenStore
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'kaizen_store_connection' );
delete_option( 'kaizen_store_api_url' );
delete_option( 'kaizen_store_shop' );
delete_option( 'kaizen_store_floating_cart' );
delete_option( 'kaizen_store_product_page' );
delete_option( 'kaizen_store_flush_rules' );
delete_option( 'kaizen_store_version' );

global $wpdb;
// phpcs:ignore WordPress.DB.DirectDatabaseQuery
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
		$wpdb->esc_like( '_transient_kaizen_store_' ) . '%',
		$wpdb->esc_like( '_transient_timeout_kaizen_store_' ) . '%'
	)
);
