'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var STATUS_FILE = '/tmp/twitchdropsminer.status.json';
var UPLOAD_FILE = '/tmp/twitchdropsminer-upload.bin';

return view.extend({
	load: function() {
		return Promise.resolve();
	},

	render: function() {
		var self = this;
		var authEl = E('div', {}, _('Loading...'));

		function refresh() {
			return fs.read(STATUS_FILE).then(function(data) {
				var st = null;

				try {
					st = JSON.parse(data);
				}
				catch (e) {}

				var auth = (st && st.auth) || {};
				var children = [
					E('p', {}, [
						_('Login:'), ' ',
						auth.logged_in
							? E('span', { 'class': 'label success' }, _('Logged in (user %d)').format(auth.user_id))
							: E('span', { 'class': 'label danger' }, _('Not logged in'))
					])
				];

				if (auth.device_code) {
					children.push(E('p', {}, [
						_('Device code:'), ' ',
						E('strong', {}, auth.device_code.user_code), ' — ',
						E('a', { 'href': auth.device_code.verification_uri, 'target': '_blank' },
							auth.device_code.verification_uri)
					]));
				}

				while (authEl.firstChild)
					authEl.removeChild(authEl.firstChild);
				for (var i = 0; i < children.length; i++)
					authEl.appendChild(children[i]);
			}).catch(function() {
				authEl.textContent = _('The miner is not running.');
			});
		}

		function upload(name, ev) {
			var input = ev.target;
			var file = input.files && input.files[0];

			if (!file)
				return;

			var reader = new FileReader();

			reader.onload = function(rev) {
				return fs.write(UPLOAD_FILE, rev.target.result)
					.then(function() {
						return fs.exec('/usr/bin/tdm-import', [ UPLOAD_FILE, name ]);
					})
					.then(function() {
						ui.addNotification(null,
							E('p', {}, _('%s has been imported. Restarting the miner...').format(name)), 'info');
						return fs.exec('/etc/init.d/twitchdropsminer', [ 'restart' ]);
					})
					.catch(function(e) {
						ui.addNotification(null,
							E('p', {}, _('Import failed: %s').format(e.message || e)), 'error');
					})
					.finally(function() {
						input.value = '';
					});
			};

			reader.readAsText(file);
		}

		poll.add(refresh, 5);
		refresh();

		return E([], [
			E('h2', {}, _('Twitch Drops Miner - Login')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Status')),
				authEl
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('cookies.jar (required)')),
				E('div', { 'class': 'cbi-section-descr' }, [
					_('Twitch device code login is currently unavailable, so the miner signs in with a saved session. ' +
					  'Log in with the miner on a PC, then upload the cookies.jar file from its directory here.')
				]),
				E('input', {
					'type': 'file',
					'accept': '.jar',
					'change': ui.createHandlerFn(self, upload, 'cookies.jar')
				})
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('settings.json (optional)')),
				E('div', { 'class': 'cbi-section-descr' }, [
					_('Upload a settings.json exported from the miner to restore its settings. ' +
					  'Note that the priority and exclude lists are normally configured on the Settings page.')
				]),
				E('input', {
					'type': 'file',
					'accept': '.json',
					'change': ui.createHandlerFn(self, upload, 'settings.json')
				})
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
