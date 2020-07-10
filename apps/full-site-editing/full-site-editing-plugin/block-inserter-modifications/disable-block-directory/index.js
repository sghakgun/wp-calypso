/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { addAction } from '@wordpress/hooks';
import { unregisterPlugin, registerPlugin } from '@wordpress/plugins';
import { __experimentalInserterMenuExtension } from '@wordpress/block-editor';

/**
 * Internal dependencies
 */
import { isSimpleSite } from '../utils';
import './style.css';

if ( isSimpleSite ) {
	addAction(
		'plugins.pluginRegistered',
		'full-site-editing/disable-block-registry',
		( settings, name ) => {
			if ( name === 'block-directory' ) {
				unregisterPlugin( name );
			}
		}
	);

	// Check if the experimental slot is available before registering the plugin.
	if ( typeof __experimentalInserterMenuExtension !== 'undefined' ) {
		registerPlugin( 'disable-block-registry', {
			render: () => (
				<__experimentalInserterMenuExtension>
					{ ( { hasResults } ) => {
						if ( ! hasResults ) {
							// We need to define our own 'no results' until we enable Block Directory.
							return (
								<div className="disable-block-directory__no-results">
									{ /* translators: Displayed when block search returns no results. */ }
									{ __( 'No results found.', 'full-site-editing' ) }
								</div>
							);
						}
						return null;
					} }
				</__experimentalInserterMenuExtension>
			),
		} );
	}
}
