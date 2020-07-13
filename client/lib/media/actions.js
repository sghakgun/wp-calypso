/**
 * External dependencies
 */
import { assign } from 'lodash';
import debugFactory from 'debug';
const debug = debugFactory( 'calypso:media' );

/**
 * Internal dependencies
 */
import Dispatcher from 'dispatcher';
import wpcom from 'lib/wp';
import { reduxDispatch, reduxGetState } from 'lib/redux-bridge';
import { createTransientMedia, getFileUploader } from './utils';
import getMediaItemErrors from 'state/selectors/get-media-item-errors';
import MediaStore from './store';
import MediaListStore from './list-store';
import {
	changeMediaSource,
	createMediaItem,
	failMediaItemRequest,
	failMediaRequest,
	receiveMedia,
	successMediaItemRequest,
	successMediaRequest,
} from 'state/media/actions';

/**
 * @typedef IMediaActions
 *
 * TODO: Better method types
 *
 * @property {Function} fetch
 */

/**
 * @type {IMediaActions}
 */
const MediaActions = {
	_fetching: {},
};

/**
 * Constants
 */
const ONE_YEAR_IN_MILLISECONDS = 31540000000;

MediaActions.setQuery = function ( siteId, query ) {
	Dispatcher.handleViewAction( {
		type: 'SET_MEDIA_QUERY',
		siteId: siteId,
		query: query,
	} );
};

MediaActions.fetchNextPage = function ( siteId ) {
	if ( MediaListStore.isFetchingNextPage( siteId ) ) {
		return;
	}

	Dispatcher.handleViewAction( {
		type: 'FETCH_MEDIA_ITEMS',
		siteId: siteId,
	} );

	const query = MediaListStore.getNextPageQuery( siteId );

	const mediaReceived = ( error, data ) => {
		Dispatcher.handleServerAction( {
			type: 'RECEIVE_MEDIA_ITEMS',
			error: error,
			siteId: siteId,
			data: data,
			query: query,
		} );
		if ( error ) {
			reduxDispatch( failMediaRequest( siteId, query, error ) );
		} else {
			reduxDispatch( successMediaRequest( siteId, query ) );
			reduxDispatch( receiveMedia( siteId, data.media, data.found, query ) );
		}
	};

	debug( 'Fetching media for %d using query %o', siteId, query );

	if ( ! query.source ) {
		wpcom.site( siteId ).mediaList( query, mediaReceived );
	} else {
		wpcom.undocumented().externalMediaList( query, mediaReceived );
	}
};

const getExternalUploader = ( service ) => ( file, siteId ) => {
	return wpcom.undocumented().site( siteId ).uploadExternalMedia( service, [ file.guid ] );
};

function uploadFiles( uploader, files, site ) {
	// We offset the current time when generating a fake date for the transient
	// media so that the first uploaded media doesn't suddenly become newest in
	// the set once it finishes uploading. This duration is pretty arbitrary,
	// but one would hope that it would never take this long to upload an item.
	const baseTime = Date.now() + ONE_YEAR_IN_MILLISECONDS;
	const siteId = site.ID;

	return files.reduce( ( lastUpload, file, i ) => {
		// Assign a date such that the first item will be the oldest at the
		// time of upload, as this is expected order when uploads finish
		const date = new Date( baseTime - ( files.length - i ) ).toISOString();

		// Generate a fake transient item that can be used immediately, even
		// before the media has persisted to the server
		const transientMedia = { date, ...createTransientMedia( file ) };
		if ( file.ID ) {
			transientMedia.ID = file.ID;
		}

		Dispatcher.handleViewAction( {
			type: 'CREATE_MEDIA_ITEM',
			siteId: siteId,
			data: transientMedia,
			site,
		} );

		// Abort upload if file fails to pass validation.
		if ( getMediaItemErrors( reduxGetState(), siteId, transientMedia.ID ).length ) {
			return Promise.resolve();
		}

		// If there are no errors, dispatch the create media item action
		reduxDispatch( createMediaItem( site, transientMedia ) );

		return lastUpload.then( () => {
			// Achieve series upload by waiting for the previous promise to
			// resolve before starting this item's upload
			const action = { type: 'RECEIVE_MEDIA_ITEM', id: transientMedia.ID, siteId };

			return uploader( file, siteId )
				.then( ( data ) => {
					Dispatcher.handleServerAction(
						Object.assign( action, {
							data: data.media[ 0 ],
						} )
					);

					reduxDispatch( successMediaItemRequest( siteId, transientMedia.ID ) );
					reduxDispatch(
						receiveMedia(
							siteId,
							{ ...data.media[ 0 ], transientId: transientMedia.ID },
							data.found
						)
					);

					// also refetch media limits
					Dispatcher.handleServerAction( {
						type: 'FETCH_MEDIA_LIMITS',
						siteId: siteId,
					} );
				} )
				.catch( ( error ) => {
					Dispatcher.handleServerAction( Object.assign( action, { error } ) );
					reduxDispatch( failMediaItemRequest( siteId, transientMedia.ID, error ) );
				} );
		} );
	}, Promise.resolve() );
}

MediaActions.addExternal = function ( site, files, service ) {
	return uploadFiles( getExternalUploader( service ), files, site );
};

MediaActions.add = function ( site, files ) {
	if ( files instanceof window.FileList ) {
		files = [ ...files ];
	}

	if ( ! Array.isArray( files ) ) {
		files = [ files ];
	}

	return uploadFiles( getFileUploader(), files, site );
};

MediaActions.sourceChanged = function ( siteId ) {
	debug( 'Media data source changed' );
	Dispatcher.handleViewAction( {
		type: 'CHANGE_MEDIA_SOURCE',
		siteId,
	} );
	reduxDispatch( changeMediaSource( siteId ) );
};

export default MediaActions;
