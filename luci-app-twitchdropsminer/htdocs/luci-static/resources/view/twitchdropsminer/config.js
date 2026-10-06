'use strict';
'require view';
'require form';
'require fs';

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('twitchdropsminer', _('Twitch Drops Miner'),
			_('Configuration of the Twitch Drops Miner service. ' +
			  'Saving applies the settings and restarts the miner.'));

		s = m.section(form.NamedSection, 'main', 'twitchdropsminer');

		o = s.option(form.Flag, 'enabled', _('Enable'),
			_('Start the miner together with the system.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'data_dir', _('Data directory'),
			_('Directory for cookies.jar, settings and logs.'));
		o.default = '/etc/twitchdropsminer';
		o.rmempty = false;

		o = s.option(form.ListValue, 'log_level', _('Log level'));
		o.value('0', _('Error'));
		o.value('1', _('Warning'));
		o.value('2', _('Info'));
		o.value('3', _('Debug (calls)'));
		o.value('4', _('Debug (everything)'));
		o.default = '2';

		/*
		 * The list mirrors the lang/<name>.json files shipped in the twitch-drops-miner
		 * package, in the same order the desktop GUI offers them: English first, then
		 * the rest sorted. An unknown value is not fatal - main.py catches the
		 * ValueError from set_language() and falls back to English.
		 */
		o = s.option(form.ListValue, 'language', _('Language'),
			_('Language used by the miner for its log and messages (requires a restart).'));
		o.value('English', 'English');
		o.value('Dansk', 'Dansk');
		o.value('Deutsch', 'Deutsch');
		o.value('Español', 'Español');
		o.value('Français', 'Français');
		o.value('Indonesian', 'Indonesian');
		o.value('Italiano', 'Italiano');
		o.value('Magyar', 'Magyar');
		o.value('Nederlandse', 'Nederlandse');
		o.value('Norsk', 'Norsk');
		o.value('Polski', 'Polski');
		o.value('Português', 'Português');
		o.value('Română', 'Română');
		o.value('Türkçe', 'Türkçe');
		o.value('Čeština', 'Čeština');
		o.value('Русский', 'Русский');
		o.value('Українська', 'Українська');
		o.value('العربية', 'العربية');
		o.value('日本語', '日本語');
		o.value('简体中文', '简体中文');
		o.value('繁體中文', '繁體中文');
		o.default = 'English';

		o = s.option(form.Value, 'connection_quality', _('Connection quality'),
			_('1 = best connection, 6 = worst. Affects request timeouts.'));
		o.datatype = 'range(1,6)';
		o.default = '1';

		o = s.option(form.ListValue, 'priority_mode', _('Priority mode'),
			_('What to mine when none of the priority games are available.'));
		o.value('0', _('Priority list only'));
		o.value('1', _('Ending soonest'));
		o.value('2', _('Low availability first'));
		o.default = '0';

		o = s.option(form.Flag, 'available_drops_check', _('Available drops check'),
			_('Check if drops can be earned on a channel before switching to it (slower).'));
		o.default = '0';

		/*
		 * The desktop GUI files this one under "Advanced", behind a warning that the
		 * options there can make the miner misbehave. Keep that warning in the
		 * description, since the LuCI form has no separate advanced section.
		 */
		o = s.option(form.Flag, 'enable_badges_emotes',
			_('Enable partial support for badges and emotes'),
			_('Campaigns that only offer badges and emotes are skipped unless this is enabled, and the miner may misbehave with it on.'));
		o.default = '0';

		o = s.option(form.Value, 'proxy', _('Proxy'),
			_('HTTP proxy URL, e.g. http://192.168.1.2:7890'));
		o.placeholder = 'http://host:port';
		o.rmempty = true;

		o = s.option(form.DynamicList, 'priority', _('Priority list'),
			_('Games to mine first, in order of importance.'));
		o.placeholder = _('Game name');

		o = s.option(form.DynamicList, 'exclude', _('Excluded games'),
			_('Games to never mine.'));

		return m.render();
	},

	handleSaveApply: function(ev, mode) {
		return this.super('handleSaveApply', [ ev, mode ]).then(function() {
			return fs.exec('/etc/init.d/twitchdropsminer', [ 'restart' ]);
		});
	}
});
